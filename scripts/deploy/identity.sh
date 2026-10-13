#!/usr/bin/env bash
# Read only the validated project identity; do not evaluate manifest text as shell.
project_slug=$(python3 -c 'import json,re; from pathlib import Path; v=json.loads(Path("project.config.json").read_text())["slug"]; assert re.fullmatch(r"[a-z][a-z0-9-]{2,39}",v); print(v)')

export project_slug
