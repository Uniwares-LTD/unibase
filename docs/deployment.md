# VPS deployment

The application uses one non-root Next.js standalone image. `/api/health/live`
reports process availability without dependency checks. `/api/health/ready`
checks runtime configuration, availability of the mounted Firebase service-account
file for the configured project, and a MongoDB ping under a shared five-second
deadline. It returns 503 with no internal error details on failure. Credential
availability does not prove real OAuth or email delivery; exercise those during
staging acceptance. Probes are uncached. Releases supply `RELEASE_COMMIT` so checks
can distinguish the expected application from a stale release.

## Host inputs

Reuse an existing Linux VPS with Docker, Compose 2.30 or newer (raw env files),
Python 3, curl and flock, plus existing SSH access through Cloudflare Access.
Automation does not install Docker, change host SSH configuration, provision VPS
capacity, or alter other applications. Applying host operations requires the
configured privileged operator. Docker and operator credentials are privileged;
restrict the GitHub environments and Access service token accordingly.

Prepare `config.json` in the configuration root declared by `scripts/deploy/vps.sh`,
using [the example](../deploy/config.example.json). Retained host paths and naming
constraints are defined in `scripts/deploy/vps.sh` and `scripts/deploy/config.py`.
This documentation change does not rename host resources.
Replace every placeholder, including the Base GHCR image repository, tunnel
UUIDs and a verified immutable cloudflared image digest. Origins must be canonical
`https://hostname` values without a trailing slash or explicit port.
Staging and production require distinct HTTPS origins, loopback ports, Firebase
projects, Atlas database names/users and Cloudflare tunnel UUIDs. Both sets of identities must be
declared before either environment can release. Only the selected environment's
credential files are read by its release operation.

Each `staging` and `production` subdirectory under that configuration root needs:

- `runtime.env`: unquoted `KEY=value` entries, based on `.env.example`, with the
  exact corresponding APP_ENV, APP_ORIGIN, Firebase project and database. Set
  AUTH_MODE=firebase. Remove emulator settings and ANDROID_HOST; only documented
  application settings are accepted. Atlas database/user names must match the prefix enforced by `scripts/deploy/config.py`;
  inspect that validator before creating resources.
- `firebase.json`: a service-account credential belonging to that Firebase project.
- `tunnel-token`: the environment's Cloudflare Tunnel token. Its encoded tunnel ID
  must match the configured UUID; copying a production token to staging is rejected
  even when the token secret has been rotated. Configure its public
  hostname to `http://app:3000`; no application port is exposed beyond loopback.
- `docker/config.json`: provision scoped read-packages GHCR pull credentials using
  `docker --config "$CONFIG_ROOT/ENV/docker" login ghcr.io`, replacing `ENV`
  and setting `CONFIG_ROOT` to the script-defined root. Use a dedicated credential
  with access to the Base package. CI's push token is never copied to the VPS.

Keep all files private and outside Git. Snapshot credential files are owned by
UID 1001 with mode 0400 so the non-root containers can read them. The credential
and tunnel files are mounted read-only, never built into the image.

Create a separate Cloudflare Access application for operator SSH. The public
production hostname must remain accessible without operator Access login.
Provision Firebase authorized domains/providers and Atlas user/network access
separately. Run `npm run db:indexes` from an authorized checkout against each database before live
account acceptance; release and rollback never modify database contents.

## Operations

From a checkout containing `scripts/deploy` and `deploy/compose.yml`, preview:

```sh
bash scripts/deploy/vps.sh setup staging
```

Only explicit `--apply` mutates host resources:

```sh
sudo bash scripts/deploy/vps.sh setup staging --apply
sudo bash scripts/deploy/vps.sh deploy staging --apply ghcr.io/OWNER/REPO@sha256:DIGEST COMMIT
sudo bash scripts/deploy/vps.sh check staging --apply
sudo bash scripts/deploy/vps.sh rollback staging --apply
```

Replace example identity/digest/commit with real validated values. Setup is
idempotent and creates only the application directories declared in the host
script. Operations share the application host lock. Each environment has
its own Compose project and retained release directories. Candidate images are
pulled before replacement. Local readiness and external HTTPS readiness must both
return the candidate commit. Failure restores the previous image **and matching
configuration**; first-release failure stops the failed project because no prior
release exists. Rollback changes no data and makes no assumption about database
schema compatibility. This initial single-instance approach permits brief downtime.
Old snapshots contain secrets; retention cleanup is an explicit operator task.

## GitHub configuration and remaining verification

Create protected `staging` and `production` GitHub environments. Release branches
are `_staging` and `_prod` respectively. Configure variables VPS_HOST, VPS_USER,
CLOUDFLARED_VERSION and CLOUDFLARED_SHA256, and secrets DEPLOY_SSH_PRIVATE_KEY,
DEPLOY_SSH_HOST_KEY (key type and base64 key only), CF_ACCESS_CLIENT_ID and
CF_ACCESS_CLIENT_SECRET. VPS_HOST is the Access SSH hostname. Pin the host key
from a trusted channel, not an unchecked scan during deployment. Pin the official
cloudflared download checksum. SSH strictly verifies that host key.

The release workflow checks environment/branch/current remote commit before
building and again before host access. Build failure cannot execute host steps.
GHCR package visibility must remain private; automation never changes visibility.
Quality workflows are independent and their outcomes are advisory. `npm run
validate` records per-check logs and actual exit codes under `output/validation`.
An unavailable check tool is a warning, never a fabricated pass.

Use the release workflow on the corresponding release branch for a manual release;
pushes to those branches also release. The deployment-check and rollback workflows
are explicit manual operations. The host-setup workflow previews by default; select `apply` only when ready to create the
selected environment's directories. The operator account needs non-interactive
`sudo` for the supplied host script; provision that access separately. Do not add
quality workflows as required release branch checks.

Successful builds report available advisory outcomes for the same commit without
waiting for the quality workflow. If its artifact is unavailable, the summary says
pending/unavailable rather than claiming a pass. Known warnings produce “Built
successfully with quality warnings.” The independent artifact remains the source
of actual individual outcomes.

## Local verification and staging acceptance

The image contains `payment-worker.cjs`, `ai-worker.cjs` and `worker-healthcheck.cjs`. Compose starts
`worker` and `ai-worker` with the same immutable image and runtime env file as
the web app, without public worker ports. The AI worker also receives the Firebase
credential mount for access checks. The runtime allowlist accepts payment settings,
`DIFY_MODE`, `DIFY_BASE_URL`, `DIFY_BINDINGS_JSON`, named `DIFY_KEY_*` secrets and
`AI_PRICING_JSON` and `APP_STYLE` (`classic`, `glass`, `soft-blue`); startup validates configuration. Releases and rollback replace
the app and both workers together. Install all indexes using `npm run db:indexes`
and verify both workers separately in staging. Each worker emits progress to MongoDB
and a local health file. Compose probes every 15 seconds; release/check/rollback
requires fresh, non-error worker progress separately from web readiness. Disabled
AI reports disabled and passes the process probe. Five-minute stale progress fails.
Retained releases predating this probe remain rollback-compatible and explicitly
report worker health as unverified. These probes do not certify live provider
compatibility. Keep Dify disabled until configured;
see [AI setup and pricing](ai-testing.md). See
[payments](payments.md); no provider or live deployment has been activated.

```sh
npm run build
npm run test:health
node scripts/start-integration.mjs
npm run test:deployment
npm run validate
```

`test:health` runs a standalone server with a generated synthetic credential and
owned disposable MongoDB. It verifies valid availability, wrong project, invalid
key, missing file, recovery and database failure. It never requests real Firebase
tokens. `test:deployment` needs a local Docker engine: it builds a Linux tooling
image and runs the actual release/host scripts with mocked registry, Docker,
Cloudflare and SSH services in a disposable container. It verifies warning-only
release eligibility, failed-build/no-host-contact, remote commit guards, public
package rejection, environment/tunnel isolation, candidate failure restoration,
rollback without data commands, setup idempotency and concurrent host locking.
These tests do not prove live GHCR permissions, Access policy, tunnel routing or
provider connectivity. The Auth Emulator account integration command remains
separate, documented in [M2 testing](local-testing.md).

The startup check creates its own env file with a unique public-name canary,
verifies `npm start`'s underlying standalone entry point reads it, and cleans up
its owned process tree and fixture. It does not edit `.env.local`. Docker image
smoke verification also checked non-root execution, exclusion of env files and
development tools, safe failed readiness, account rendering and public assets.

For live staging acceptance, configure the inputs above, install all indexes,
release `_staging`, then verify public HTTPS, real Google/email journeys and Atlas
profile persistence. Run deployment checking and a manual rollback. Exercise a
deliberately unavailable dependency in staging and verify restoration of its prior
release. Confirm production and other VPS applications are unaffected. Verify the
GHCR package is private and the scoped pull identity works. Only then activate
production. No live resource has been provisioned or deployed by this implementation.
