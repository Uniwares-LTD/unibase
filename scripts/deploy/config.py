"""Validate fixed Unitale host inputs without evaluating env files as shell code."""
import json
import base64
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, unquote
from uuid import UUID


def validate(root, target):
    config = json.loads((root / "config.json").read_text())
    if not re.fullmatch(r"ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+", config["imageRepository"]):
        raise ValueError("Invalid Unitale image repository")
    fields = ("origin", "port", "firebaseProject", "mongoDatabase", "mongoUser", "tunnelId")
    for key in fields:
        if config["staging"][key] == config["production"][key]:
            raise ValueError("Environment identities must be distinct")
    for name in ("staging", "production"):
        item = config[name]
        if str(UUID(item["tunnelId"])) != item["tunnelId"] or UUID(item["tunnelId"]).int == 0:
            raise ValueError("Invalid tunnel identity")
        url = urlsplit(item["origin"])
        if (url.scheme != "https" or not url.hostname or url.username or
                item["origin"] != "https://" + url.hostname or url.query or url.fragment or
                url.hostname.endswith(".invalid")):
            raise ValueError("Invalid application origin")
        if type(item["port"]) is not int or not 1024 <= item["port"] <= 65535:
            raise ValueError("Invalid application port")
        if not re.fullmatch(r"cloudflare/cloudflared@sha256:[a-f0-9]{64}", item["tunnelImage"]):
            raise ValueError("Tunnel image must use a digest")
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", item["firebaseProject"]):
            raise ValueError("Invalid Firebase project")
        if not re.fullmatch(r"unitale_[A-Za-z0-9_]+", item["mongoDatabase"]):
            raise ValueError("Database must be Unitale-specific")
        if not re.fullmatch(r"unitale_[A-Za-z0-9_]+", item["mongoUser"]):
            raise ValueError("Database user must be Unitale-specific")
    item = config[target]
    directory = root / target
    env = {}
    allowed = {"APP_NAME", "APP_STYLE", "APP_ENV", "APP_ORIGIN", "AUTH_MODE", "FIREBASE_PROJECT_ID",
               "FIREBASE_API_KEY", "FIREBASE_APP_ID", "MONGODB_URI", "MONGODB_DATABASE",
               "ANDROID_PACKAGE_NAME", "ANDROID_SHA256_FINGERPRINTS",
               "PAYMENTS_MODE", "CREDIT_PACKS_JSON", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
               "DIFY_MODE", "DIFY_BASE_URL", "DIFY_ORCHESTRATORS_JSON", "DIFY_CONSOLE_URL", "DIFY_MANAGEMENT_KEY", "DIFY_WORKSPACE_ID", "DIFY_CREDENTIAL_ENCRYPTION_KEY",
               "ASSET_STORE", "ASSET_S3_ENDPOINT", "ASSET_S3_REGION", "ASSET_S3_BUCKET",
               "ASSET_S3_PREFIX", "ASSET_S3_ACCESS_KEY_ID", "ASSET_S3_SECRET_ACCESS_KEY",
               "ASSET_S3_FORCE_PATH_STYLE"}
    for line in (directory / "runtime.env").read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        if (key not in allowed and not re.fullmatch(r"DIFY_KEY_[A-Z0-9_]+", key)) or key in env:
            raise ValueError("Unknown or duplicate runtime setting")
        env[key] = value
    if env.get("APP_STYLE", "classic") not in ("classic", "glass", "soft-blue"):
        raise ValueError("Invalid APP_STYLE")
    if env.get("ASSET_STORE", "mongo") not in ("mongo", "s3"):
        raise ValueError("Invalid ASSET_STORE")
    if env.get("ASSET_STORE") == "s3":
        asset_url = urlsplit(env.get("ASSET_S3_ENDPOINT", ""))
        if (asset_url.scheme != "https" or not asset_url.hostname or asset_url.username or
                asset_url.password or asset_url.query or asset_url.fragment or asset_url.path not in ("", "/")):
            raise ValueError("Invalid asset storage endpoint")
        for required in ("ASSET_S3_REGION", "ASSET_S3_BUCKET", "ASSET_S3_ACCESS_KEY_ID", "ASSET_S3_SECRET_ACCESS_KEY"):
            if not env.get(required):
                raise ValueError("Incomplete private asset storage configuration")
    mode = env.get("DIFY_MODE", "disabled")
    if mode not in ("disabled", "fake", "live"):
        raise ValueError("Invalid Dify mode")
    if mode == "live":
        if env.get("DIFY_CREDENTIAL_ENCRYPTION_KEY") and not re.fullmatch(r"[a-fA-F0-9]{64}",env["DIFY_CREDENTIAL_ENCRYPTION_KEY"]):
            raise ValueError("Invalid Dify credential encryption secret")
        dify_url = urlsplit(env.get("DIFY_BASE_URL", ""))
        if (dify_url.scheme != "https" or not dify_url.hostname or dify_url.username or
                dify_url.password or dify_url.query or dify_url.fragment or
                not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*v1/?", dify_url.path)):
            raise ValueError("Invalid Dify API URL")
        definitions=json.loads(env.get("DIFY_ORCHESTRATORS_JSON", "[]"))
        if not isinstance(definitions,list) or len(definitions)>100:
            raise ValueError("Invalid orchestrator registrations")
        names=set()
        for definition in definitions:
            if not isinstance(definition,dict) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}",definition.get("id","")) or definition["id"] in names:
                raise ValueError("Invalid orchestrator registration")
            names.add(definition["id"])
            if not re.fullmatch(r"DIFY_KEY_[A-Z0-9_]+",definition.get("keyEnv","")):
                raise ValueError("Invalid execution credential reference")
            if "workflowId" in definition: UUID(definition["workflowId"])
        if env.get("DIFY_MANAGEMENT_KEY"):
            UUID(env.get("DIFY_WORKSPACE_ID",""))
            console=urlsplit(env.get("DIFY_CONSOLE_URL",""))
            if console.scheme!="https" or console.netloc!=dify_url.netloc or console.path!="/console/api" or console.query or console.fragment:
                raise ValueError("Invalid management connection")
    expected = {"APP_ENV": target, "APP_ORIGIN": item["origin"], "AUTH_MODE": "firebase",
                "FIREBASE_PROJECT_ID": item["firebaseProject"],
                "MONGODB_DATABASE": item["mongoDatabase"]}
    if any(env.get(k) != v for k, v in expected.items()):
        raise ValueError("Runtime environment identity mismatch")
    if not env.get("FIREBASE_API_KEY") or not env.get("FIREBASE_APP_ID"):
        raise ValueError("Missing Firebase browser identifiers")
    mongo = urlsplit(env["MONGODB_URI"])
    if (mongo.scheme != "mongodb+srv" or not mongo.hostname or not mongo.password or
            unquote(mongo.username or "") != item["mongoUser"]):
        raise ValueError("Scoped Atlas credentials required")
    credential = json.loads((directory / "firebase.json").read_text())
    if (credential.get("project_id") != item["firebaseProject"] or
            credential.get("type") != "service_account" or not credential.get("private_key")):
        raise ValueError("Firebase credential project mismatch")
    # cloudflared ParseToken uses standard-base64 JSON; validate the tunnel ID
    # rather than comparing token strings, because secret rotation changes them.
    token = json.loads(base64.b64decode((directory / "tunnel-token").read_text().strip(), validate=True))
    if token.get("t") != item["tunnelId"] or not token.get("a") or not base64.b64decode(token["s"], validate=True):
        raise ValueError("Tunnel token identity mismatch")
    # Output only non-secret, validated Compose inputs, one value per line.
    return [item["origin"], str(item["port"]), item["tunnelImage"], config["imageRepository"]]


if __name__ == "__main__":
    try:
        print("\n".join(validate(Path(sys.argv[1]), sys.argv[2])))
    except Exception:
        sys.exit("Invalid Unitale deployment configuration (values suppressed)")
