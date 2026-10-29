"""Serialize the only request accepted by the installed shared dispatcher."""
import json
import re
import sys
from pathlib import Path
from environment import load
from release_settings import configuration_hash

root = Path(__file__).resolve().parents[2]
action, target = sys.argv[1:3]
if action not in ('deploy', 'check', 'rollback') or target != 'staging':
    sys.exit('Restricted dispatcher supports staging deploy/check/rollback only')
config = load(target, require_connections=False)
request = {'version': 1, 'project': json.loads((root / 'project.config.json').read_text())['slug'],
           'environment': target, 'action': action,
           'configurationHash': configuration_hash(config)}
if action == 'deploy':
    image, commit = sys.argv[3:5]
    if not re.fullmatch(r'ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}', image) or not re.fullmatch(r'[a-f0-9]{40}', commit):
        sys.exit('Invalid release identity')
    request.update(image=image, commit=commit)
print(json.dumps(request))
