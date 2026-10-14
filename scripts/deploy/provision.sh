#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077
# shellcheck source=scripts/deploy/identity.sh
source "$(dirname "${BASH_SOURCE[0]}")/identity.sh"
target=${1:?environment required}
mode=${2:-preview}
case "$target:$mode" in staging:preview|staging:apply|production:preview|production:apply) ;; *) exit 1 ;; esac
[[ ${GITHUB_REF:-} == refs/heads/main ]] || { echo 'Provisioning requires main' >&2; exit 1; }
for key in GOOGLE_ACCESS_TOKEN ATLAS_CLIENT_ID ATLAS_CLIENT_SECRET GHCR_PULL_TOKEN; do
  [[ -n ${!key:-} ]] || { echo "Missing secret: $key" >&2; exit 1; }
done
ssh_config=${RUNNER_TEMP:?}/${project_slug}-access/config
archive=$(mktemp "$RUNNER_TEMP/${project_slug}-provision.XXXXXXXX.tar.gz")
credentials=$(mktemp "$RUNNER_TEMP/${project_slug}-credentials.XXXXXXXX.json")
remote=''
cleanup() {
  rm -f "$archive" "$credentials"
  if [[ -n "$remote" ]]; then
    ssh -F "$ssh_config" "${project_slug}-vps" "sudo -n rm -rf -- $remote" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
python3 - "$credentials" <<'PY'
import json,os,sys
keys=['GOOGLE_ACCESS_TOKEN','ATLAS_CLIENT_ID','ATLAS_CLIENT_SECRET','GHCR_PULL_TOKEN','GOOGLE_OAUTH_CLIENT_SECRET']
with open(sys.argv[1],'w') as file: json.dump({key:os.environ.get(key,'') for key in keys},file)
PY
# Explicit source allowlist: private files, caches and existing host state cannot enter.
git ls-files -z package.json package-lock.json project.config.json tsconfig.json src scripts deploy messages |
  tar --exclude='deploy/config.json' --exclude='*.env' --exclude='*credentials*.json' --exclude='*service-account*.json' --exclude='*.pem' --exclude='*.key' --exclude='*/secrets/*' --null -T - -czf "$archive"
remote=$(ssh -F "$ssh_config" "${project_slug}-vps" "umask 077; mktemp -d /tmp/${project_slug}-provision.XXXXXXXX")
[[ "$remote" =~ ^/tmp/${project_slug}-provision\.[a-zA-Z0-9]{8}$ ]] || { remote=''; echo 'Invalid remote staging directory' >&2; exit 1; }
scp -F "$ssh_config" "$archive" "${project_slug}-vps:$remote/bundle.tar.gz"
# Never place credentials in command arguments or an uploaded workflow artifact.
ssh -F "$ssh_config" "${project_slug}-vps" "sudo -n sh -c 'umask 077; cat > $remote/credentials.json'" < "$credentials"
apply=''
[[ "$mode" != apply ]] || apply=--apply
# UID is validated locally and passed through a file rather than shell interpolation.
python3 - "$RUNNER_TEMP/admin-uid.json" <<'PY'
import json,os,sys
uid=os.environ.get('ADMIN_UID','')
if len(uid)>128 or any(c in uid for c in '\r\n\0'): raise SystemExit('Invalid admin UID')
with open(sys.argv[1],'w') as file: json.dump(uid,file)
PY
scp -F "$ssh_config" "$RUNNER_TEMP/admin-uid.json" "${project_slug}-vps:$remote/admin-uid.json"
ssh -F "$ssh_config" "${project_slug}-vps" "set -eu; mkdir -m 700 $remote/source; tar -xzf $remote/bundle.tar.gz -C $remote/source; sudo -n python3 $remote/source/scripts/deploy/provision.py $target $apply --credentials $remote/credentials.json --admin-uid-file $remote/admin-uid.json"
