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
        token = os.environ.get("SHARED_OWNER_TOKEN")
        if not token:
            raise ValueError("Missing secret: SHARED_OWNER_TOKEN")
        slug = json.loads((ROOT / "project.config.json").read_text())["slug"]
        request_routes(load(args.environment), os.environ["GITHUB_REPOSITORY"], slug, token, args.apply)
    except Exception as error:
        print(str(error) if isinstance(error, (ValueError, ProviderError)) else "Shared route operation failed (details suppressed)", file=sys.stderr)
        sys.exit(1)
