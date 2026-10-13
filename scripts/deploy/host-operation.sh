#!/usr/bin/env bash
set -Eeuo pipefail
set +x
# shellcheck source=scripts/deploy/identity.sh
source "$(dirname "${BASH_SOURCE[0]}")/identity.sh"
action=${1:?action required}
target=${2:?target required}
image=${3:-}
commit=${4:-}
case "$action" in setup|check|rollback) [[ -z "$image$commit" ]] ;; deploy) [[ "$image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ && "$commit" =~ ^[a-f0-9]{40}$ ]] ;; *) exit 1 ;; esac
case "$target" in staging|production) ;; *) exit 1 ;; esac
ssh_config=${RUNNER_TEMP:?}/${project_slug}-access/config
archive=$(mktemp "$RUNNER_TEMP/${project_slug}-bundle.XXXXXXXX.tar.gz")
: > "$RUNNER_TEMP/${project_slug}-operation.log"
remote=''
cleanup() {
  local result=$?
  if [[ -n ${GITHUB_STEP_SUMMARY:-} && -f "$RUNNER_TEMP/${project_slug}-operation.log" ]]; then
    grep -E '^result=(healthy|restored) environment=(staging|production) commit=[a-f0-9]{40} image=ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$' "$RUNNER_TEMP/${project_slug}-operation.log" >> "$GITHUB_STEP_SUMMARY" || true
  fi
  rm -f "$archive"
  if [[ -n "$remote" ]]; then ssh -F "$ssh_config" "${project_slug}-vps" "rm -rf -- $remote" >/dev/null 2>&1 || true; fi
  return "$result"
}
trap cleanup EXIT
tar -czf "$archive" scripts/deploy deploy/compose.yml deploy/nginx.conf project.config.json
remote=$(ssh -F "$ssh_config" "${project_slug}-vps" "umask 077; mktemp -d /tmp/${project_slug}.XXXXXXXX")
[[ "$remote" =~ ^/tmp/${project_slug}\.[a-zA-Z0-9]{8}$ ]] || { remote=''; echo 'Invalid remote staging directory' >&2; exit 1; }
scp -F "$ssh_config" "$archive" "${project_slug}-vps:$remote/bundle.tar.gz"
ssh -F "$ssh_config" "${project_slug}-vps" "set -eu; tar -xzf $remote/bundle.tar.gz -C $remote; sudo -n bash $remote/scripts/deploy/vps.sh $action $target --apply $image $commit" | tee "$RUNNER_TEMP/${project_slug}-operation.log"
