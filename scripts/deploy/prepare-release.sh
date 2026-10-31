#!/usr/bin/env bash
# Explicit protected-change preparation; never installs configuration or deploys.
set -Eeuo pipefail
set +x
target=${1:?target required}
[[ "$target" != production ]] || target=prod
case "$target" in staging|prod) ;; *) exit 2 ;; esac
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || exit 2
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
runtime_target=$target
[[ "$target" != prod ]] || runtime_target=production
bash "$script_dir/guard.sh" "$runtime_target"
python3 "$script_dir/operations.py" doctor "$target"
bash "$script_dir/access.sh"
# Capability discovery, not configuration compatibility, precedes explicit preparation.
python3 - "$target" "$script_dir" <<'PY'
import json,sys
sys.path.insert(0,sys.argv[2])
from operations import transport, ROOT
from environment import load
slug=json.loads((ROOT/'project.config.json').read_text())['slug']
response=transport(dict(version=2,project=slug,environment=sys.argv[1],action='capabilities'),load(sys.argv[1]),timeout=45)
if response.get('version')!=2 or not {'operation-lock-v1','plans-v2','github-oidc-v1'}.issubset(response.get('capabilities',[])):
    raise SystemExit('Install compatible Infrastructure controller before preparation.')
PY
python3 "$script_dir/public-package.py" before
candidate="$RUNNER_TEMP/release-candidate.json"
image="ghcr.io/${GITHUB_REPOSITORY,,}"
if [[ ! -f "$candidate" ]]; then
  printf '%s' "${GH_TOKEN:?}" | docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin
  docker buildx build --push --tag "$image:$GITHUB_SHA" --label "org.opencontainers.image.revision=$GITHUB_SHA" --metadata-file "$RUNNER_TEMP/image.json" .
  python3 - "$RUNNER_TEMP/image.json" "$candidate" "$image" "$GITHUB_SHA" <<'PY'
import json,re,sys
digest=json.load(open(sys.argv[1]))['containerimage.digest']
if not re.fullmatch('sha256:[a-f0-9]{64}',digest):raise SystemExit('Invalid image identity')
json.dump({'sourceCommit':sys.argv[4],'image':sys.argv[3]+'@'+digest},open(sys.argv[2],'w'))
PY
fi
image=$(python3 -c 'import json,sys; sys.path.insert(0,sys.argv[1]); from candidate import validate; print(validate(json.load(open(sys.argv[2])),sys.argv[3],sys.argv[4])["image"])' "$script_dir" "$candidate" "$GITHUB_SHA" "$GITHUB_REPOSITORY")
python3 "$script_dir/public-package.py" after
anonymous=$(mktemp -d "$RUNNER_TEMP/anonymous-prepare.XXXXXXXX")
trap 'rm -rf -- "$anonymous"' EXIT
docker --config "$anonymous" pull "$image"
bundle="$RUNNER_TEMP/control-$GITHUB_SHA.tar"
python3 "$script_dir/build-bundle.py" . "$GITHUB_SHA" "$bundle"
bash "$script_dir/guard.sh" "$runtime_target"
python3 "$script_dir/operations.py" plan "$target" --bundle "$bundle" --manifest "$bundle.manifest.json" --image "$image" > "$RUNNER_TEMP/deployment-plan.json"
python3 - "$RUNNER_TEMP/deployment-plan.json" "${GITHUB_STEP_SUMMARY:?}" <<'PY'
import json,sys
plan=json.load(open(sys.argv[1]))
with open(sys.argv[2],'a') as output:
    output.write('Prepared plan: `'+plan['planId']+'`\n\nApprove this exact digest in Infrastructure Apply deployment plan. No host configuration or service was changed.\n')
PY
