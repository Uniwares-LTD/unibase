#!/usr/bin/env bash
set -Eeuo pipefail
set +x
# shellcheck source=scripts/deploy/identity.sh
source "$(dirname "${BASH_SOURCE[0]}")/identity.sh"
action=${1:?action required}
target=${2:?target required}
image=${3:-}
commit=${4:-}
case "$action" in check|rollback) [[ -z "$image$commit" ]] ;; deploy) [[ "$image" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ && "$commit" =~ ^[a-f0-9]{40}$ ]] ;; *) exit 1 ;; esac
case "$target" in staging|production|prod) ;; *) exit 1 ;; esac
ssh_config=${RUNNER_TEMP:?}/${project_slug}-access/config
# Only structured requests reach installed, root-owned control code in both environments.
python3 "$(dirname "${BASH_SOURCE[0]}")/dispatch-request.py" "$action" "$target" "$image" "$commit" |
  ssh -F "$ssh_config" "${project_slug}-vps" operate
