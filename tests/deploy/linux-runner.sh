#!/usr/bin/env bash
# Disposable mount namespace/chroot for mocked service tests; no Docker daemon.
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run this test harness as local Linux root.' >&2; exit 2; }
repo=$(cd "$(dirname "$0")/../.." && pwd)
infrastructure=$(cd "$repo/../infrastructure" && pwd)
root=$(mktemp -d /tmp/uniwares-deploy-tests.XXXXXXXX)
cleanup() { rm -rf -- "$root"; }
trap cleanup EXIT
mkdir -p "$root"/{usr,bin,sbin,lib,lib64,etc,dev,tmp,opt,var/lib,repo,infrastructure,proc}
chmod 1777 "$root/tmp"
for name in scripts tests deploy src messages project.config.json package.json package-lock.json tsconfig.json; do
  cp -a "$repo/$name" "$root/repo/"
done
cp -a "$infrastructure/scripts" "$root/infrastructure/"
# Match a Linux Git checkout even when the source is a Windows working tree.
python3 - "$root" <<'PY'
from pathlib import Path
import sys
for base in ('repo', 'infrastructure'):
    for path in (Path(sys.argv[1]) / base).rglob('*.sh'):
        path.write_bytes(path.read_bytes().replace(b'\r\n', b'\n'))
PY
for name in passwd group nsswitch.conf ld.so.cache; do
  [[ ! -f /etc/$name ]] || cp "/etc/$name" "$root/etc/$name"
done
mknod -m 666 "$root/dev/null" c 1 3
mknod -m 666 "$root/dev/zero" c 1 5
mknod -m 666 "$root/dev/urandom" c 1 9
unshare --mount --pid --fork --propagation private bash -s -- "$root" "$repo" "$infrastructure" <<'RUN'
set -Eeuo pipefail
root=$1 repo=$2 infrastructure=$3
for name in usr bin sbin lib lib64; do
  if [[ -d /$name ]]; then
    mount --bind "/$name" "$root/$name"
    mount -o remount,bind,ro "$root/$name"
  fi
done
mount -t proc proc "$root/proc"
chroot "$root" /usr/bin/env -i PATH=/usr/bin:/bin HOME=/tmp PYTHONDONTWRITEBYTECODE=1 UNIBASE_DEPLOY_TEST_CONTAINER=1 \
  /bin/bash -c 'cd /repo && python3 -B -m unittest discover -s tests/deploy -v'
RUN
