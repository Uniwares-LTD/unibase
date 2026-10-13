#!/usr/bin/env bash
# Configure one ephemeral SSH alias; never disable host-key checking.
set -Eeuo pipefail
set +x
# shellcheck source=scripts/deploy/identity.sh
source "$(dirname "${BASH_SOURCE[0]}")/identity.sh"
umask 077
for key in VPS_HOST VPS_USER DEPLOY_SSH_PRIVATE_KEY DEPLOY_SSH_HOST_KEY CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET CLOUDFLARED_VERSION CLOUDFLARED_SHA256; do
  [[ -n ${!key:-} ]] || { echo "Missing $key" >&2; exit 1; }
done
[[ "$VPS_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$VPS_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 1
[[ "$CLOUDFLARED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$CLOUDFLARED_SHA256" =~ ^[a-f0-9]{64}$ ]] || exit 1
access_dir=${RUNNER_TEMP:?}/${project_slug}-access
mkdir -p "$access_dir"
chmod 0700 "$access_dir"
curl --fail --silent --show-error --location --output "$access_dir/cloudflared" \
  "https://github.com/cloudflare/cloudflared/releases/download/$CLOUDFLARED_VERSION/cloudflared-linux-amd64"
printf '%s  %s\n' "$CLOUDFLARED_SHA256" "$access_dir/cloudflared" | sha256sum --check --status
chmod 0700 "$access_dir/cloudflared"
printf '%s\n' "$DEPLOY_SSH_PRIVATE_KEY" > "$access_dir/key"
printf '%s %s\n' "$VPS_HOST" "$DEPLOY_SSH_HOST_KEY" > "$access_dir/known_hosts"
cat > "$access_dir/config" <<EOF
Host ${project_slug}-vps
  HostName $VPS_HOST
  User $VPS_USER
  IdentityFile $access_dir/key
  IdentitiesOnly yes
  BatchMode yes
  ConnectTimeout 20
  ServerAliveInterval 15
  ServerAliveCountMax 3
  StrictHostKeyChecking yes
  UserKnownHostsFile $access_dir/known_hosts
  ProxyCommand $access_dir/cloudflared access ssh --hostname %h
EOF
chmod 0600 "$access_dir/key" "$access_dir/known_hosts" "$access_dir/config"
printf 'TUNNEL_SERVICE_TOKEN_ID=%s\nTUNNEL_SERVICE_TOKEN_SECRET=%s\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" >> "${GITHUB_ENV:?}"
echo "SSH_CONFIG=$access_dir/config" >> "${GITHUB_ENV:?}"
