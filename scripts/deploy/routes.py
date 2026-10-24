"""Request registered routes from the sole shared-infrastructure owner."""
import argparse
import base64
import json
import os
import sys
import time
import uuid
from urllib.parse import quote, urlencode
from environment import ROOT, load
from providers import API, ProviderError


def verify_owner_managed(config, token, api=None):
    """Read the owner's live route and DNS; never mutate its complete route list."""
    from urllib.parse import urlsplit
    import fnmatch
    api = api or API({"GOOGLE_ACCESS_TOKEN": "", "ATLAS_CLIENT_ID": "", "ATLAS_CLIENT_SECRET": ""})
    shared = config['shared']
    host = urlsplit(config['runtime']['APP_ORIGIN']).hostname
    headers = {'Authorization': 'Bearer ' + token}
    endpoint = 'https://api.cloudflare.com/client/v4/'
    value = api.request('GET', endpoint + 'accounts/' + shared['cloudflareAccountId'] +
                        '/cfd_tunnel/' + shared['tunnelId'] + '/configurations', headers=headers)
    if value.get('success') is not True:
        raise ValueError('Unable to read owner tunnel configuration')
    rules = value.get('result', {}).get('config', {}).get('ingress', [])
    selected = next((rule for rule in rules if not rule.get('hostname') or
                     fnmatch.fnmatchcase(host, rule['hostname'])), None)
    if (not selected or selected.get('hostname') != host or selected.get('path') or
            selected.get('service') not in (f"http://localhost:{config['deployment']['port']}",
                                            f"http://127.0.0.1:{config['deployment']['port']}")):
        raise ValueError('Owner route is missing, shadowed or targets a different listener')
    dns = api.request('GET', endpoint + 'zones/' + shared['cloudflareZoneId'] +
                      '/dns_records?' + urlencode({'name': host}), headers=headers)
    records = dns.get('result', [])
    if (dns.get('success') is not True or len(records) != 1 or records[0].get('type') != 'CNAME' or
            records[0].get('content') != shared['tunnelId'] + '.cfargotunnel.com' or
            records[0].get('proxied') is not True):
        raise ValueError('DNS does not select the owner tunnel')
    print('Owner-managed tunnel route and DNS verified; no mutation requested')


def validate_registry(registry, config, repository, slug):
    shared = config["shared"]
    if registry.get("version") != 1 or registry.get("ownerRepository") != shared["ownerRepository"]:
        raise ValueError("Shared route owner mismatch")
    for key in ("tunnelId", "cloudflareAccountId", "cloudflareZoneId"):
        if registry.get(key) != shared[key]:
            raise ValueError("Shared infrastructure identity mismatch: " + key)
    matches = [entry for entry in registry.get("applications", []) if entry.get("repository") == repository and
               entry.get("slug") == slug and entry.get("environment") == config["environment"] and entry.get("enabled") is True]
    if len(matches) != 1:
        raise ValueError("Application route is not uniquely registered in the owner repository")
    from urllib.parse import urlsplit
    if matches[0].get("hostname") != urlsplit(config["runtime"]["APP_ORIGIN"]).hostname or matches[0].get("port") != config["deployment"]["port"]:
        raise ValueError("Registered application route differs from tracked config")


def request_routes(config, repository, slug, token, apply=False, api=None):
    api = api or API({"GOOGLE_ACCESS_TOKEN": "", "ATLAS_CLIENT_ID": "", "ATLAS_CLIENT_SECRET": ""})
    shared = config["shared"]
    endpoint = "https://api.github.com/repos/" + shared["ownerRepository"]
    headers = {"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    document = api.request("GET", endpoint + "/contents/infra/config/shared-app-routes.json?" + urlencode({"ref": shared["ownerRef"]}), headers=headers)
    registry = json.loads(base64.b64decode(document["content"]))
    validate_registry(registry, config, repository, slug)
    workflow = endpoint + "/actions/workflows/" + quote(shared["routeWorkflow"], safe="")
    details = api.request("GET", workflow, headers=headers)
    if details.get("state") != "active":
        raise ValueError("Shared owner route workflow is not active")
    if not apply:
        print("Shared route registry and owner workflow verified; no route mutation requested")
        return
    request_id = str(uuid.uuid4())
    api.request("POST", workflow + "/dispatches", {
        "ref": shared["ownerRef"], "inputs": {"repository": repository, "slug": slug,
        "environment": config["environment"], "request_id": request_id, "apply": "true"}}, headers)
    print("Requested registered shared routes; request=" + request_id)
    deadline = time.monotonic() + 1200
    while time.monotonic() < deadline:
        runs = api.request("GET", workflow + "/runs?event=workflow_dispatch&per_page=100", headers=headers)
        matches = [run for run in runs.get("workflow_runs", []) if request_id in run.get("display_title", "")]
        if len(matches) > 1:
            raise ProviderError("Ambiguous shared route operation")
        if matches and matches[0]["status"] == "completed":
            if matches[0].get("conclusion") != "success":
                raise ProviderError("Shared owner route operation failed; inspect its workflow summary")
            print("Shared owner route operation succeeded")
            return
        time.sleep(10)
    raise ProviderError("Shared owner route operation timed out; inspect request before retrying")


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("environment", choices=["staging", "production"])
        parser.add_argument("--apply", action="store_true")
        args = parser.parse_args()
        config = load(args.environment)
        if config['shared'].get('routeMode') == 'owner-managed':
            if args.apply:
                raise ValueError('Route changes must be applied by the existing owner')
            token = os.environ.get('CLOUDFLARE_READ_TOKEN')
            if not token:
                raise ValueError('Missing secret: CLOUDFLARE_READ_TOKEN')
            verify_owner_managed(config, token)
            sys.exit(0)
        token = os.environ.get("SHARED_OWNER_TOKEN")
        if not token:
            raise ValueError("Missing secret: SHARED_OWNER_TOKEN")
        slug = json.loads((ROOT / "project.config.json").read_text())["slug"]
        request_routes(load(args.environment), os.environ["GITHUB_REPOSITORY"], slug, token, args.apply)
    except Exception as error:
        print(str(error) if isinstance(error, (ValueError, ProviderError)) else "Shared route operation failed (details suppressed)", file=sys.stderr)
        sys.exit(1)
