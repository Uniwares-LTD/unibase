#!/usr/bin/env bash
set -Eeuo pipefail
target=${1:?target required}
[[ "$target" != prod ]] || target=production
case "$target" in staging) branch=_staging ;; production) branch=_prod ;; *) echo 'Invalid release environment' >&2; exit 1 ;; esac
[[ ${GITHUB_REF:-} == "refs/heads/$branch" ]] || { echo 'Release branch mismatch' >&2; exit 1; }
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit' >&2; exit 1; }
remote=$(gh api "repos/${GITHUB_REPOSITORY:?}/git/ref/heads/$branch" --jq .object.sha)
[[ "$remote" == "$GITHUB_SHA" ]] || { echo 'Release commit is no longer branch head' >&2; exit 1; }
printf 'environment=%s commit=%s\n' "$target" "$GITHUB_SHA"
