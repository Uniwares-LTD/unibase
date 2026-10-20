# VPS deployment

## Environment flows

| Environment | Entry point | Identity and services |
| --- | --- | --- |
| Local | `npm run dev` | Tracked local defaults, private overrides, Firebase Auth Emulator and local MongoDB; no cloud credentials |
| Staging | `_staging` push or manual Release | Shared staging Firebase account pool, app-specific web registration, database/user, Redis, Nginx port and Compose project |
| Production | `_prod` push or manual Release | App-specific Firebase project, database/user, Redis, Nginx port and Compose project |

All public hostnames use the existing host Cloudflare connector. Both release
environments use the same existing SSH Access hostname/application. This project
does not create, reinstall, restart or own that connector or Dify Community.
`agentic-poc` remains their owner; its Terraform writes the complete tunnel route
list. New app routes go through its registered-route workflow, never a direct
Cloudflare API update from an app repository.

Authentication-level account changes/revocations affect the shared staging Firebase
pool; app roles and application data remain isolated in each app database.

The maintenance/payment worker and AI worker are background containers built from
the same image as the web app. The maintenance worker reconciles payments,
maintains credits, delivers queued notifications and cleans up files/assets. The
AI worker executes queued Runs, decisions and result application. They continue
working without a browser. Release/check verify fresh worker progress separately
from web readiness; disabled AI still reports process health.

## Tracked configuration

`deploy/environments/local.json`, `staging.json` and `production.json` own public
application/deployment settings. GitHub configuration variables are no longer
used, including for Android. Secrets remain GitHub environment secrets and private
host files. Dev/start and administration commands load tracked local defaults after
Next.js private env files; explicit process/private values win locally. Live images
use generated runtime files. Builds receive no live credentials or deployment config.

On provisioning and release, non-null tracked `runtime` values override matching
private host values. To activate an optional integration, update its tracked mode
as well as its private credentials; changing only `runtime.env` cannot override a
tracked disabled mode. Rollback uses the retained release snapshot instead of
merging the current tracked settings.

Configure these fields before the first preview:

- `runtime`: exact environment, canonical HTTPS origin, display/style defaults,
  Firebase project ID and app-scoped database name. Keep Dify, payments and MCP
  disabled until their integrations are configured. Firebase browser app ID/API
  key are discovered during provisioning and retained privately as runtime values.
- `deployment`: GHCR repository matching `ghcr.io/<owner>/<repository>` in lowercase
  for this workflow repository (the same in both environments), free loopback port, unused private bridge subnet,
  and verified immutable Redis, Nginx and Node administration-image digests.
- `ssh`: existing Access hostname/operator and pinned cloudflared version/checksum.
- `google`: shared staging project ID; distinct production project ID and explicit
  `organizations/ID` or `folders/ID` parent; OIDC provider resource and provisioner
  service-account email. `runtime.FIREBASE_PROJECT_ID` must match `google.projectId`.
- `atlas`: existing project/cluster, environment-scoped user and exact VPS egress
  address (`/32` for IPv4, `/128` for IPv6). No new cluster capacity is provisioned.
- `shared`: owner repository/ref, registered-route workflow, and existing
  tunnel/account/zone identifiers matching the owner registry.
- `ghcr.pullUser`: account with access to the private image package.
- `android`: production wrapper hostname/package when Android delivery is needed.

Connection placeholders intentionally remain unset. Validation names missing
fields before host/provider mutation. Public settings may be committed; credentials
must not be put in these JSON documents. The runtime allowlist remains the
[environment catalog](environment-catalog.md).

For derived projects, `--infrastructure-profile PATH` explicitly selects shared
connections. Without it the initializer clears source SSH/provider/owner connections
and derives fresh project names, databases/users, paths, workflow labels and suggested
ports/subnets. Profiles allow only the documented public connection sections; they
never carry credentials. Review host allocations even when using suggested values.

The base now uses `unibase` namespaces. Old `unitale` databases and private files
are neither migrated nor deleted. Existing `.env.local` values still override the
new defaults; review those overrides to start with fresh local namespaces.

## Secrets and one-time access bootstrap

Create GitHub environments `staging` and `production`. In **Repository Settings >
Environments > selected environment > Add environment secret**, enter the following
names and private values. Allow `main` for provisioning and the matching release
branch (`_staging` or `_prod`) for release/check/rollback. No GitHub variables are needed.

| Secret | Obtain and scope | Consumer |
| --- | --- | --- |
| `DEPLOY_SSH_PRIVATE_KEY` | Deployment operator's private SSH key; authorize its public key on the existing VPS | Pinned SSH workflows |
| `DEPLOY_SSH_HOST_KEY` | Existing host's public key, verified through a trusted channel; key type and base64 key only | Strict host verification |
| `CF_ACCESS_CLIENT_ID` | Existing SSH Access service-token client ID | cloudflared SSH |
| `CF_ACCESS_CLIENT_SECRET` | Matching service-token secret; existing SSH Access policy must allow it | cloudflared SSH |
| `GHCR_PULL_TOKEN` | Classic GitHub PAT with `read:packages`; account must read the private package, with organization SSO authorization if required | Provisioning installs Docker pull authentication |
| `ATLAS_CLIENT_ID` | Atlas service-account client ID with Project Owner on the selected existing Atlas project | Add scoped users/network entries |
| `ATLAS_CLIENT_SECRET` | Matching Atlas service-account secret; allow VPS egress in its API access policy if enforced | Atlas administration |
| `SHARED_OWNER_TOKEN` | Fine-grained GitHub PAT selecting only the owner repository, Contents read and Actions read/write | Read registration, dispatch and observe owner workflow |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Optional client secret for `google.oauthClientId` | Enable Google provider when supplied and not already enabled |

CI publishing uses automatic `GITHUB_TOKEN` with `packages:write`; never copy that
token to the VPS. Confirm private-package visibility and actual scoped pulls during
first release. Docker login alone does not prove package-level read authorization.
The pinned SSH host key is obtained from the existing VPS through trusted access,
not an unchecked network scan. Operator access must support noninteractive sudo
for the supplied host scripts; Docker/operator access is privileged.

Google administration uses GitHub OIDC rather than a stored long-lived provisioner
key. An administrator must first create the workload identity pool/provider and
provisioner service account in an existing administration project. Restrict trust to
this repository, `refs/heads/main`, and the intended environment subjects. Grant
Workload Identity User to those principals. On the existing staging project, grant
`roles/firebase.admin`, `roles/serviceusage.serviceUsageAdmin`,
`roles/iam.serviceAccountAdmin`, `roles/iam.serviceAccountKeyAdmin` and
`roles/resourcemanager.projectIamAdmin`. Grant `roles/resourcemanager.projectCreator`
on the production parent plus the corresponding administration permissions for
created projects.
Set provider/service-account identifiers in tracked configuration. Org policies
that prohibit service-account keys require an explicit operator decision; scripts
never change those policies or attach billing accounts.

OAuth consent screens, OAuth web-client creation and redirect URI approval remain
operator setup. Authorize `https://APP_HOST/__/auth/handler`. Provisioning enables
Email/Password and merges authorized domains when Firebase Auth is initialized;
it optionally enables a supplied Google provider. A new project may require the
Firebase console's Authentication **Get started** step, then another provisioning
run. The public initializeAuth API enables billing-only Identity Platform, so this
workflow does not silently upgrade the project. Keep Firebase-hosted verification
and password-reset action handlers and authorize the app return URL. Configure
password policy and email-enumeration protection in the Firebase console.

Cloudflare DNS/tunnel administration credentials stay in the owner repository's
existing Infrastructure workflow, including its protected Terraform state access.
Unibase needs no Cloudflare API token or tunnel token. Install/review the
[owner integration](../deploy/shared-owner/README.md) before provisioning.

Optional runtime Stripe, Dify, MCP and S3 credentials are needed only on activation;
see [payments](payments.md), [Runs](runs.md) and [MCP](mcp.md). Keep encryption secrets
stable across web/worker processes and retained accepted work. They remain private
runtime settings, never tracked environment values.

## First provisioning

The existing Linux VPS must provide Docker, Compose **2.30+**, Python 3, curl and
flock. Provisioning checks Docker/Compose, port and subnet collisions and existing
provider ownership. Host capacity, Docker installation/upgrades, SSH/Access setup,
provider accounts and one-time OIDC trust remain operator prerequisites.

1. Fill tracked staging/production config and GitHub secrets; prepare the owner
   registration with matching repository, slug, environment, hostname and port.
   Enable only reviewed entries. Keep provider/connection identities out of derived
   projects unless their shared profile is explicitly selected.
2. Open **Actions > Provision environment > Run workflow**, select `main` and the
   target environment, and leave **apply** off. Preview verifies owner registration,
   pinned SSH, Google/Atlas access, Docker prerequisites, allocations and GHCR login
   without changing provider resources or persistent app configuration.
3. Run again with **apply** on. It creates missing production Firebase projects/web
   apps/runtime service accounts, reuses staging Firebase, creates scoped Atlas
   users/exact network entries, writes private host config, generates missing Redis
   and database passwords, installs GHCR pull authentication and runs indexes in a
   disposable pinned Node administration container. It then requests owner-managed
   routes and waits for the correlated owner workflow result.
4. Resolve any explicit pending Firebase/OAuth bootstrap items and rerun. Repeated
   apply reuses generated credentials and registrations. It never rotates keys,
   deletes resources, resets databases or starts an application release.
5. Release `_staging`, create/verify the intended first-admin account, obtain its
   Firebase UID and optionally rerun provisioning with **admin_uid**. Disabled or
   unverified accounts are refused; a second active-admin bootstrap is refused.
6. Verify staging live acceptance, then provision/release production separately.

Private files live under `/etc/<slug>/<environment>/`: `runtime.env`, `firebase.json`,
`redis-password`, `provision-state.json` and `docker/config.json`. Database passwords
are persisted before user creation so an interrupted run can reuse them. Host
files/directories stay private; snapshot credentials are UID 1001/mode 0400 and
mounted read-only. Provider admin credentials use transient private request files,
are removed on completion, and never enter runtime files or image layers.

Provisioning also generates `/etc/<slug>/config.json` from the tracked environment
documents. `deploy/config.example.json` illustrates this host format; it is not the
configuration input for the workflows. Releases and their configuration snapshots
live under `/opt/<slug>/<environment>/releases/`, with `current` and `previous`
symlinks in the environment directory. The application operation lock lives at
`/var/lib/<slug>/operation.lock`.

Missing saved credentials for an existing Atlas user or Firebase key stop provisioning.
Recover the private files through the operator's approved backup procedure rather
than automatically replacing keys. Partial provisioning is additive; inspect the
reported failure/pending step and rerun after correction. If an owner-route request
times out, inspect its request ID before retrying; it may still be running.

## Operations

Pushes to `_staging` and `_prod` release automatically. Manual Release must select
the matching branch/environment. It guards branch/current remote commit before
building and again before host access, publishes a private commit-tagged GHCR image
and deploys its immutable digest. Build/operational failures stop release; quality
reports remain advisory. No required quality branch checks are added.

Host operations remain available from a reviewed checkout:

```sh
bash scripts/deploy/vps.sh setup staging
sudo bash scripts/deploy/vps.sh setup staging --apply
sudo bash scripts/deploy/vps.sh check staging --apply
sudo bash scripts/deploy/vps.sh rollback staging --apply
```

Setup only creates project directories; the provisioning workflow installs config
and indexes. Check and Rollback are also manual GitHub workflows on the matching
release branch. Operations share the app host lock and workflow concurrency group.
Shared infrastructure operations additionally serialize in the owner repository.
Provisioning on this VPS also takes a project-scoped shared Firebase lock, so two
derived apps cannot overwrite each other's authorized-domain additions.

Releases snapshot private config and merge the selected tracked runtime settings.
Changing infrastructure/provider identity requires provisioning first. Pull and
revision verification precede replacement. Web and both workers use one image;
local and public HTTPS readiness must report the expected commit. Failed candidates
restore the previous image and matching configuration. First-release failure stops
the candidate because no previous release exists. Database rollback is never
automatic, and this single-instance setup permits brief interruptions. Old snapshots
contain secrets; retention cleanup is an explicit operator task.

Nginx is the only app ingress. The shared host connector routes to its loopback
port; Nginx trusts CF-Connecting-IP only from that bridge's host gateway and overwrites
forwarded headers. Redis has no published port. The public production app remains
accessible without the operator SSH Access login.

## Local verification and staging acceptance

Run `npm run build`, `npm run typecheck`, `npm run test:deployment`,
`npm run check:workflows`, `npm run check:shell` and affected account tests.
Deployment tests run in a disposable Linux container with synthetic providers,
SSH, registry and Docker; they never provision production services. Provider tests
cover preview, repeated apply, interrupted configuration, identity conflicts and
secret-safe errors. The owner package has registry tests and mock Terraform tests.

Live acceptance remains separate: verify real Firebase Google/email journeys,
Atlas persistence, both workers, private GHCR/scoped pulls and public HTTPS. After
two successful staging releases, exercise Check/Rollback and failed-candidate
restoration; confirm production and other hosted apps are unaffected. Only then
activate production. No live provisioning or deployment is claimed from local tests.

## Shared ownership follow-ups

- Transfer the shared tunnel to a dedicated infrastructure owner with Terraform
  state, route registry, credentials, locks and preservation of every SSH/app/Dify
  route. Avoid simultaneous route-list writers during handoff.
- Transfer Dify Community lifecycle separately, retaining installation version,
  private credentials, databases/storage, backups and service continuity. No
  reinstallation or provider activation is included in this change.
