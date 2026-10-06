#!/usr/bin/env bash
# One tested release sequence. Advisory reports never determine release eligibility.
set -Eeuo pipefail
set +x
target=${1:?target required}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
digest=''
image=''
outcome=failed
report() {
  local safe_target=unknown safe_commit=unknown safe_image=unavailable
  case "$target" in staging|production) safe_target=$target ;; esac
  [[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] && safe_commit=$GITHUB_SHA
  [[ "$image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+$ && "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] && safe_image=$image@$digest
  printf 'Release result=%s environment=%s commit=%s image=%s\n' "$outcome" "$safe_target" "$safe_commit" "$safe_image" >> "${GITHUB_STEP_SUMMARY:?}"
}
trap report EXIT
bash "$script_dir/guard.sh" "$target"
python3 "$script_dir/private-package.py" before
for key in VPS_HOST VPS_USER CLOUDFLARED_VERSION CLOUDFLARED_SHA256 DEPLOY_SSH_PRIVATE_KEY DEPLOY_SSH_HOST_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET; do
  [[ -n ${!key:-} ]] || { echo "Missing $key" >&2; exit 1; }
done
image="ghcr.io/${GITHUB_REPOSITORY,,}"
printf '%s' "${GH_TOKEN:?}" | docker login ghcr.io -u "${GITHUB_ACTOR:?}" --password-stdin
docker buildx build --push --tag "$image:$GITHUB_SHA" --label "org.opencontainers.image.revision=$GITHUB_SHA" --metadata-file "$RUNNER_TEMP/image.json" .
digest=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["containerimage.digest"])' "$RUNNER_TEMP/image.json")
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Build did not produce an immutable digest' >&2; exit 1; }
python3 "$script_dir/private-package.py" after
python3 "$script_dir/quality-summary.py" || echo 'Advisory report unavailable; build succeeded.' >> "$GITHUB_STEP_SUMMARY"
bash "$script_dir/guard.sh" "$target"
# Access setup exports the SSH config for this shell and later cleanup.
bash "$script_dir/access.sh"
export TUNNEL_SERVICE_TOKEN_ID=$CF_ACCESS_CLIENT_ID
export TUNNEL_SERVICE_TOKEN_SECRET=$CF_ACCESS_CLIENT_SECRET
# Recheck after downloading the access helper, immediately before host contact.
bash "$script_dir/guard.sh" "$target"
bash "$script_dir/host-operation.sh" deploy "$target" "$image@$digest" "$GITHUB_SHA"
outcome=healthy
