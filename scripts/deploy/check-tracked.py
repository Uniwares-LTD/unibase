"""Require provisioning before changing installed infrastructure identities."""
import json
import sys
from pathlib import Path
from environment import load

try:
    root, target = Path(sys.argv[1]), sys.argv[2]
    desired = load(target, require_connections=False)
    installed = json.loads((root / "config.json").read_text())
    fields = {"origin": desired["runtime"]["APP_ORIGIN"], "firebaseProject": desired["google"]["projectId"],
              "mongoDatabase": desired["runtime"]["MONGODB_DATABASE"], "mongoUser": desired["atlas"]["mongoUser"],
              **{key: desired["deployment"][key] for key in ("port", "ingressSubnet", "redisImage", "nginxImage")}}
    if any(value is not None and installed[target].get(key) != value for key, value in fields.items()):
        raise ValueError("Installed infrastructure differs from tracked config; provision this environment first")
    repository = desired["deployment"]["imageRepository"]
    if repository is not None and repository != installed["imageRepository"]:
        raise ValueError("Installed image repository differs; provision this environment first")
except Exception as error:
    print(str(error) if isinstance(error, ValueError) else "Cannot verify installed public configuration", file=sys.stderr)
    sys.exit(1)
