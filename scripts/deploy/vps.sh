#!/usr/bin/env bash
# Only fixed Unitale paths and Compose projects are managed. Never source env files.
set -Eeuo pipefail
set +x
umask 077
action=${1:-}
target=${2:-}
mode=${3:-}
image=${4:-}
commit=${5:-}
case "$action" in setup|deploy|check|rollback) ;; *) echo 'Use setup|deploy|check|rollback staging|production [--apply] [digest commit]' >&2; exit 2 ;; esac
case "$target" in staging|production) ;; *) echo 'Invalid target' >&2; exit 2 ;; esac
case "$mode" in ''|--apply) ;; *) echo 'Invalid mode' >&2; exit 2 ;; esac
root=/opt/unitale
config=/etc/unitale
state=/var/lib/unitale
project=unitale-$target
base=$root/$target
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
if [[ "$mode" != --apply ]]; then
  printf 'Preview: %s %s; only /opt/unitale, /etc/unitale, /var/lib/unitale and project %s\n' "$action" "$target" "$project"
  exit 0
fi
[[ $(id -u) == 0 ]] || { echo 'Apply requires the configured privileged operator' >&2; exit 1; }
for tool in docker python3 curl flock; do command -v "$tool" >/dev/null; done
docker compose version >/dev/null
install -d -m 0700 "$root" "$config" "$state"
exec 9>"$state/operation.lock"
flock -w 300 9 || { echo 'Unitale operation already running' >&2; exit 1; }
if [[ "$action" == setup ]]; then
  install -d -m 0700 "$base/releases" "$config/$target" "$config/$target/docker"
  echo 'Unitale directories ready; existing host services unchanged'
  exit 0
fi
[[ -d "$base/releases" ]] || { echo 'Run Unitale setup first' >&2; exit 1; }
export DOCKER_CONFIG=$config/$target/docker
compose() { docker compose --project-name "$project" --env-file "$1/compose.env" -f "$1/compose.yml" "${@:2}"; }
report() {
  local outcome=$1 release=$2 saved_commit saved_image
  saved_commit=$(sed -n 's/^RELEASE_COMMIT=//p' "$release/compose.env")
  saved_image=$(sed -n 's/^IMAGE_DIGEST=//p' "$release/compose.env")
  [[ "$saved_commit" =~ ^[a-f0-9]{40}$ && "$saved_image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]] || return 1
  printf 'result=%s environment=%s commit=%s image=%s\n' "$outcome" "$target" "$saved_commit" "$saved_image"
}
check_release() {
  local release=$1 origin port expected
  origin=$(sed -n 's/^APP_ORIGIN=//p' "$release/runtime.env")
  port=$(sed -n 's/^APP_PORT=//p' "$release/compose.env")
  expected=$(sed -n 's/^RELEASE_COMMIT=//p' "$release/compose.env")
  local probe
  for probe in "http://127.0.0.1:$port" "$origin"; do
    local ok=false
    for ((attempt=0; attempt<12; attempt++)); do
      if curl --silent --fail --max-time 7 "$probe/api/health/ready" | \
        python3 -c 'import json,sys; x=json.load(sys.stdin); sys.exit(0 if x.get("status")=="ready" and x.get("commit")==sys.argv[1] else 1)' "$expected" 2>/dev/null; then
        ok=true; break
      fi
      sleep 3
    done
    [[ "$ok" == true ]] || return 1
  done
}
current=''
[[ ! -L "$base/current" ]] || current=$(readlink -f "$base/current")
if [[ -n "$current" ]]; then
  [[ "$current" == "$base/releases/"* && -f "$current/compose.env" ]] || { echo 'Invalid retained release path' >&2; exit 1; }
  grep -qx "DEPLOY_ENV=$target" "$current/compose.env" || { echo 'Retained environment mismatch' >&2; exit 1; }
fi
if [[ "$action" == check ]]; then
  [[ -n "$current" ]] || { echo 'No current release' >&2; exit 1; }
  check_release "$current"
  report healthy "$current"
  exit 0
fi
if [[ "$action" == rollback ]]; then
  [[ -L "$base/previous" ]] || { echo 'No retained previous release' >&2; exit 1; }
  candidate=$(readlink -f "$base/previous")
  [[ "$candidate" == "$base/releases/"* && -f "$candidate/compose.env" ]] || { echo 'Invalid rollback path' >&2; exit 1; }
  grep -qx "DEPLOY_ENV=$target" "$candidate/compose.env" || { echo 'Rollback environment mismatch' >&2; exit 1; }
else
  [[ "$image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]] || { echo 'Immutable GHCR digest required' >&2; exit 1; }
  [[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
  values=$(python3 "$script_dir/config.py" "$config" "$target")
  mapfile -t settings <<< "$values"
  [[ "$image" == "${settings[3]}@"* ]] || { echo 'Image repository does not match Unitale configuration' >&2; exit 1; }
  candidate=$(mktemp -d "$base/releases/$commit.XXXXXXXX")
  cp "$script_dir/../../deploy/compose.yml" "$candidate/compose.yml"
  cp "$config/$target/runtime.env" "$candidate/runtime.env"
  cp "$config/$target/firebase.json" "$candidate/firebase.json"
  cp "$config/$target/tunnel-token" "$candidate/tunnel-token"
  chown 1001:1001 "$candidate/firebase.json" "$candidate/tunnel-token"
  chmod 0400 "$candidate/firebase.json" "$candidate/tunnel-token"
  printf 'DEPLOY_ENV=%s\nIMAGE_DIGEST=%s\nRELEASE_COMMIT=%s\nAPP_PORT=%s\nTUNNEL_IMAGE=%s\n' \
    "$target" "$image" "$commit" "${settings[1]}" "${settings[2]}" > "$candidate/compose.env"
fi
# Pull/configure before replacing the existing instance. No DB mutations occur.
compose "$candidate" config --quiet
compose "$candidate" pull --quiet
candidate_image=$(sed -n 's/^IMAGE_DIGEST=//p' "$candidate/compose.env")
candidate_commit=$(sed -n 's/^RELEASE_COMMIT=//p' "$candidate/compose.env")
[[ "$candidate_image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ && "$candidate_commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid retained image identity' >&2; exit 1; }
revision=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$candidate_image")
[[ "$revision" == "$candidate_commit" ]] || { echo 'Image revision does not match the release commit' >&2; exit 1; }
restore() {
  trap - ERR INT TERM HUP
  if [[ -n "$current" ]]; then
    if compose "$current" up -d --remove-orphans && check_release "$current"; then report restored "$current"; else echo 'Previous release restoration failed; operator intervention required' >&2; fi
  else
    compose "$candidate" down
    echo 'First release failed; no previous release exists' >&2
  fi
  exit 1
}
trap restore ERR INT TERM HUP
compose "$candidate" up -d --remove-orphans
check_release "$candidate"
if [[ -n "$current" ]]; then ln -sfn "$current" "$base/previous"; fi
ln -sfn "$candidate" "$base/current"
trap - ERR INT TERM HUP
report healthy "$candidate"
