# VPS deployment

## Staging transition status — 2026-10-22

Existing commands below describe the **current implementation**, not a ready-to-run
staging installation. Shared host facts are canonical in the private
[infrastructure inventory](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/inventory/srv1.md);
shared conventions and ownership are in its
[architecture](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/architecture.md)
and [operations](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).

Observed blockers: host Compose 2.28.1 is below this provisioner's 2.30 minimum;
both suggested Unibase ingress subnets overlap Dify's network; the shared-route
workflow expected by Unibase was absent from the reviewed agentic-poc setup.
Staging connection/provider bindings remain placeholders. The October 22 GitHub
check found only `main`, no repository secrets and no environments. The organization
uses GitHub Free: the environment-secret instructions below require adaptation for
this private repository. Local M4 verification does not establish live activation.

### Target conventions and pending compatibility work

| Area | Accepted target / required implementation change |
| --- | --- |
| Ownership | Unibase and children deploy independently; infrastructure owns new shared components. Booklet, Dify and the existing tunnel retain their owner until explicit transfer. |
| Branches | `main` for development; `_staging` targets `staging`; `_prod` targets `prod`. Current code/config uses `production`; rename deliberately while preserving retained snapshots. Keep `NODE_ENV=production`. |
| SSH | Shared `uniwares-ops-admin` for privileged setup; `uniwares-deploy-user` for restricted routine dispatch, without general sudo or Docker-group membership. Current host scripts are not that dispatcher. |
| Secrets | One deploy key copied into trusted repository secrets; separate admin credential. Replace private-repository environment-secret dependence; use environment prefixes where values differ. Retain private runtime snapshots. |
| Images | Public GHCR and anonymous digest pulls. Adapt private-package publishing/pull-user checks; builds remain credential-free. |
| Firebase | Shared staging project and credentials across Unibase/children; explicit app registrations/domains. Production has a separate Firebase project per application. Adapt per-app credential provisioning without deleting existing keys. |
| Redis | Shared non-Dify instance, numbered logical DB per app/environment, shared credential, no ACL requirement. Current setup expects its own Redis at database 0; adapt validators, Compose, readiness and secret handling. |
| Dify | Existing Community, separate app IDs/keys per app/environment, tag `app:<project>-<environment>`. Tags organize bindings, not access boundaries. |
| Ingress | Proposed shared gateway behind the existing tunnel initially, retaining legacy Nginx. Remove fixed per-app ingress subnets/Nginx only after equivalent auth-helper, streaming and trusted-proxy behavior is verified. |
| Coordination | Repository Actions concurrency and runbooks for shared changes; no new cross-repository orchestration. Application leases/idempotency remain necessary. |
| Database | Runtime database-scoped `readWrite`; separate workflow recovery credentials. Verify required backup/restore actions rather than assuming `dbAdmin` alone is sufficient. |

These are target requirements, not changed workflow/schema behavior. Gateway/tunnel
integration, replacement networking, tested Compose version and off-host backup
destination remain open in the infrastructure plan.

### Current and proposed background scheduling

Current entrypoints are `scripts/ai-worker.ts` and `scripts/payment-worker.ts`.
Each sleeps two seconds **after** a completed cycle, not on a fixed two-second
deadline. No GitHub Actions cron is configured for these application jobs.

| Work | Current behavior | Proposed endpoint/cadence and reason |
| --- | --- | --- |
| AI Runs, automatic decisions, result application | User actions queue durable work; AI worker handles due records; provider calls can take 120 seconds | AI endpoint, approximately five seconds after completion; keep due times, retries, ownership, accounting and uncertain-submission recovery |
| Payment notices | Signed Stripe webhook queues idempotent notices; maintenance worker processes one per cycle | Events endpoint, about ten seconds after completion; preserve webhook authentication and durable retry |
| Notifications | Business transactions enqueue outbox records; worker delivers up to ten per cycle | Same events endpoint; bounded batches keep delivery prompt |
| Payment reconciliation | One pending order older than 15 minutes or settled order older than 24 hours per cycle | Maintenance every five minutes; retain age thresholds, process bounded batches to avoid backlog |
| Credit expiry/reservations | Checked each cycle; wallet access also reconciles expiry | Five-minute maintenance; never release managed AI reservations solely due to elapsed time |
| File/asset deletion | Leased deletion intents; abandoned staging eligible after 24 hours | Five-minute maintenance batches; preserve reference guards, retries and queued cleanup after mode changes |
| Notification expiry | Repeated inbox/outbox sweep; index setup already defines inbox expiry TTL | Verify deployed TTL, remove redundant inbox sweep, retain outbox payload compaction and permanent duplicate-prevention records |
| Runtime/rate-limit retention | MongoDB TTL and Redis key expiration | Keep native expiration, without another scheduler |
| Health | Worker heartbeat records/files, including disabled AI | Endpoint progress/last-success with cadence-aware thresholds; avoid disabled-provider polling |

Extract reusable job-cycle functions into server-only modules and add three
authenticated, bounded local HTTP endpoints. Infrastructure-managed systemd timer
templates invoke them. AI stays separate from events so long provider requests do
not delay payments/notifications. Requests await work; no untracked fire-and-forget
tasks. Timer non-overlap does not replace DB leases or safe crash recovery.
Keep optional providers disabled until configured while general maintenance remains
active. Revise release health checks before removing worker containers. Dify's own
workers are unaffected. This refactor is pending, not available today.

### Minimum staging recovery target

Add one manual workflow with `backup`/`restore` actions. Back up the app MongoDB
database including GridFS before migrations/destructive work; pause/drain writers
and timers for consistency. Verify encrypted off-host bytes, checksum and manifest
before success. Restore requires an exact backup ID and target confirmation, a
pre-restore backup and health checks before resuming writers. Rehearse a disposable
restore. Manual backups accept loss since the last successful backup; production
policy remains unresolved.

Keep image/config rollback separate from data restore. Recover secrets separately;
omit ephemeral Redis backup and extend coverage before enabling S3 media. Shared
Firebase identities and Dify recovery are outside an app database restore. The
shared operations guide owns storage/credential boundaries.

See the [staging transition plan](implementation-plan.md#shared-infrastructure-staging-transition--2026-10-22)
for implementation and acceptance.

## Staging execution and acceptance

Use the [infrastructure checkpoint runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md)
as the operational entry point. It owns access, discovery, shared setup and the
single configuration/progress checklist. This section owns application work at
checkpoints 3 and 5-8. No live operation was performed while writing this runbook.

### Prepare the application — checkpoint 3

**Owner/location:** agent in the development checkout and PR review.
**Implementation required:** complete the target adaptations above before invoking
the current workflows against shared infrastructure. In particular, repository
secrets, restricted SSH dispatch, public images, shared Redis and gateway behavior
are not compatible merely because existing workflow files are present.

Provide a reviewed build/publish preflight without host deployment. The current
release script couples these operations; do not dispatch it early just to obtain
the public candidate needed for checkpoint 5's anonymous-pull verification.

Review the exact application revision and targeted checks for job authentication,
bounded execution, duplicate suppression, lease recovery, proxy/Firebase behavior
and retained runtime snapshots. Record their results and the reviewed infrastructure
revision in the shared checklist. Quality warnings remain advisory; build and
operational failures stop release. If tooling is missing, continue implementation
on the reviewed branch rather than bypassing it with ad hoc VPS commands.

### Configure staging — checkpoint 5

**Owner/location:** agent through the reviewed provisioning workflow/provider APIs;
operator supplies only unavailable credential references through protected stores.
Prerequisites: shared host setup and the reviewed provisioning adaptations.

Populate staging JSON with the verified hostname, shared Firebase/app registration,
Atlas database/user and egress allowlist, Redis connection/database allocation,
public package identity and gateway integration. Do not reuse the colliding subnet
suggestions or copy Booklet release paths. Keep Dify/payments/MCP disabled initially.
Store secret values in repository secrets/private runtime files, never JSON or build
arguments. Provisioner OIDC, if retained, must also be verified rather than inferred
from shared Firebase credentials. Verify runtime `readWrite` separately from recovery
permissions. On interruption, preview current resources and repair only missing
bindings; preserve accepted keys, shared identities and existing application data.

### Release and verify — checkpoint 6

**Owner/location:** agent via GitHub Actions for `Uniwares-LTD/unibase`.
**Implementation required:** the files below exist today, but their target-compatible
behavior must first be implemented, reviewed and verified. Their names/inputs are
source-checked; no workflow dispatch was executed for this documentation change.

| Existing file | Current interface | Use after adaptation |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | Push `_staging`, or manual `environment=staging` on `_staging` | Deploy one reviewed staging revision |
| `.github/workflows/check-deployment.yml` | Manual `environment=staging` on `_staging` | Verify the deployed app and scheduled job progress |
| `.github/workflows/rollback.yml` | Manual `environment=staging` on `_staging` | Restore an actual retained previous image/configuration |

Before dispatch, verify the reviewed `_staging` head, workflow availability and
target match. A push already triggers Release; do not also manually dispatch the
same commit. Record workflow ID/URL, source SHA, immutable image digest and retained
configuration identity. A queued/running workflow is not acceptance evidence.
Use the workflow interface and inspected summaries; do not render private Compose
configuration or copy arbitrary logs into GitHub evidence.

Verify all of the following before marking staging accepted:

- Public hostname reaches the intended app; liveness and dependency readiness pass.
  Authentication, authorized domain and Firebase helper behavior work end to end.
- The host pulls the public image anonymously by digest; runtime secrets are absent
  from build inputs and browser responses. Retained configuration matches the release.
- The app uses its assigned Redis logical database; inspection confirms separation
  without clearing any other database. Existing Booklet/Dify/legacy health is preserved.
- All three job endpoints reject unauthorized calls; reviewed timers complete bounded
  requests and expose cadence-appropriate progress. General maintenance works with
  optional providers disabled. Live Stripe/Dify activation is a separate checkpoint;
  use isolated fixtures for retry/idempotency tests, not real charges or paid AI calls.
- Interrupted processing can resume without duplicate effects or premature release
  of managed AI credit holds; outbox duplicate-prevention records remain intact.

**Failure/resume:** inspect workflow outcome and actual candidate/prior state before
retrying. On a failed first deployment, stop only the unhealthy Unibase candidate
and its timers through reviewed tooling, retain data/configuration and redeploy a
fixed reviewed revision. There is no previous release to roll back to. Do not invoke
database restore or restart shared services. If a previous healthy release exists,
use the reviewed image/config rollback and verify it before resuming work.

### Rehearse recovery and hand off — checkpoints 7-8

**Owner/location:** agent via application workflows; operator retains protected
credential recovery references. **Implementation required:** the planned manual
backup/restore workflow does not exist yet; do not invent a dispatch command/name.

After two compatible healthy releases provide a real predecessor, exercise the
existing image/config rollback through its adapted workflow. Separately, use the
implemented backup workflow to verify an encrypted off-host staging archive and
restore it to an explicitly named disposable database. Check records, indexes and
GridFS bytes without exposing contents. Record backup ID and sanitized results.
Record an empty restore target as having no prior data; back up any nonempty target
before restore instead of assuming a disposable name means it is empty.
Shared Firebase identities and Dify resources are outside this restore.

Partial backup/restore is not success. Keep failed restoration isolated, retain its
source/pre-restore backup and diagnose before retrying. Do not automatically resume
unhealthy writers or delete source data. Record verified workflow entrypoints,
release/recovery identifiers, secret-store references and remaining work in the
shared checkpoint table. Routine deployment/check/rollback must use the restricted
account; privileged maintenance retains its separate access path.

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
