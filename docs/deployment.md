# VPS deployment

## Staging transition status — 2026-10-24

Updated October 25 after successful staging release and independent deployment check.

Shared host facts are canonical in the private
[infrastructure inventory](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/inventory/srv1.md);
shared conventions and ownership are in its
[architecture](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/architecture.md)
and [operations](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).

The staging path now uses repository secrets, public GHCR, direct pinned SSH and
Infrastructure's restricted dispatcher. Tracked staging bindings identify the
verified shared providers and `172.30.241.0/24`; allocation is rechecked at apply
time. October 25 operator evidence confirms compatible plugin installation,
restricted account/control installation, private runtime configuration and additive
index preparation. Firebase/Atlas bindings and the owner-managed tunnel/DNS route
are applied. The first staging release and independent Check deployment passed;
Google admin sign-in is user-confirmed and the existing session, profile persistence,
administration access and logout were browser-verified. Verified Phase 3 results
are recorded below; data recovery rehearsal remains later work.

### First deployment and later consolidation

First staging retains the existing worker containers, app Redis and private Nginx.
Fix only deployment blockers first: repository secrets, public images, restricted
shared SSH access, shared staging Firebase bindings, compatible Compose, a free
app subnet/port and an owner-managed tunnel route. Keep Dify, Stripe and MCP disabled.
The generic shared-route workflow is not a prerequisite: support a reviewed
owner-side route change and verify the actual hostname/target rather than skipping
the check. Existing app runtime, health, leases and idempotency remain intact.

The table below records the eventual conventions. Shared gateway/Redis, job endpoints
and production naming changes are later work, not first-release acceptance gates.

### Target conventions and pending compatibility work

| Area | Accepted target / required implementation change |
| --- | --- |
| Ownership | Unibase and children deploy independently; infrastructure owns new shared components. Booklet, Dify and the existing tunnel retain their owner until explicit transfer. |
| Branches | `main` for development; `_staging` targets `staging`; `_prod` targets `prod`. Current code/config uses `production`; rename deliberately while preserving retained snapshots. Keep `NODE_ENV=production`. |
| SSH | Shared `uniwares-ops-admin` for privileged setup; `uniwares-deploy-user` for restricted routine dispatch, without general sudo or Docker-group membership. The dispatcher is installed; operator access currently permits only fixed privileged discovery, so root-only maintenance still needs the trusted root session. |
| Secrets | One deploy key copied into trusted repository secrets; separate admin credential. Replace private-repository environment-secret dependence; use environment prefixes where values differ. Retain private runtime snapshots. |
| Images | Public GHCR and anonymous digest pulls. Staging verifies public visibility and anonymous pulls; production compatibility remains deferred. Builds remain credential-free. |
| Firebase | Shared staging project and credentials across Unibase/children; explicit app registrations/domains. Production has a separate Firebase project per application. Adapt per-app credential provisioning without deleting existing keys. |
| Redis | Shared non-Dify instance, numbered logical DB per app/environment, shared credential, no ACL requirement. Current setup expects its own Redis at database 0; adapt validators, Compose, readiness and secret handling. |
| Dify | Existing Community, separate app IDs/keys per app/environment, tag `app:<project>-<environment>`. Tags organize bindings, not access boundaries. |
| Ingress | First release uses the existing app Nginx behind the tunnel; later introduce the shared gateway, retaining legacy public Nginx. Remove fixed per-app ingress subnets/Nginx only after equivalent auth-helper, streaming and trusted-proxy behavior is verified. |
| Coordination | Repository Actions concurrency and runbooks for shared changes; no new cross-repository orchestration. Application leases/idempotency remain necessary. |
| Database | Runtime database-scoped `readWrite`; separate workflow recovery credentials. Verify required backup/restore actions rather than assuming `dbAdmin` alone is sufficient. |

Shared-service targets remain deferred; the staging adaptations below are implemented
and installed. User acceptance is recorded below. Shared gateway,
shared Redis and off-host backup decisions follow the staged infrastructure plan.

### Current and proposed background scheduling

This consolidation is deferred to a later milestone; first-release acceptance uses
existing workers and their health checks. Current entrypoints are `scripts/ai-worker.ts` and `scripts/payment-worker.ts`.
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

This is follow-up work, not a fresh first-startup prerequisite. Do not perform a
destructive operation or data migration without its required backup. Verify off-host
restoration before treating staging data as recoverable. Add one manual workflow
with `backup`/`restore` actions. Back up the app MongoDB database including GridFS
before migrations/destructive work; pause/drain app and worker writers (plus timers
after their introduction) for consistency. Verify encrypted off-host bytes, checksum and manifest
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

Follow the [three-phase infrastructure runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).
It owns access, shared setup and the single configuration/progress table. This
section owns application changes and acceptance. No live operation is performed
by publishing these instructions.

### Phase 1 — Connect and prepare

Completed. Infrastructure owns access, remaining discovery and the shared
configuration checklist. Current application inputs live in tracked environment
JSON; secret consumers and the installed staging interface are described under
[restricted control](#restricted-first-staging-control-path). Historical preparation
is linked from the shared runbook; do not rerun it for acceptance.

### Phase 2 — Bootstrap and deploy

Completed. Use the shared runbook for installed source/digest/config identity and
bootstrap evidence. Staging's release workflow builds, publishes, anonymously
pulls the immutable image, dispatches deployment and verifies local/public readiness
and existing workers. Routine instructions and failure/resume handling are in the
[shared runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md#3-verify-and-hand-off).
A failed first release has no predecessor; stop only its candidate and retain
configuration/data. Never restore the DB or restart shared services automatically.

### Phase 3 — Verify and hand off

**Owner/location:** agent through Unibase check workflows and browser verification;
operator handles credentials/MFA, email delivery and protected-store access.
Start with one consolidated request for any remaining manual results. Never ask
for passwords, private keys, session cookies or OAuth callback URLs in chat.

**Acceptance record, 2026-10-25: Phase 3 staging handoff verified.**
Initial account journeys used `edcc21d`; the corrective release `215044b` retained
the session/profile and passed fresh account/admin hydration and runtime checks.
Installed source/digest/config identities are canonical in the shared runbook.

| Check | Evidence/result | Remaining action |
| --- | --- | --- |
| Google admin sign-in | Operator confirmed initial login; browser completed a fresh Google redirect after logout | None |
| Server session and app persistence | Browser reload retained the profile; temporary display-name change survived reload; original name restored and rechecked | None |
| Administration | Reloaded `/admin` rendered administrator navigation and one active admin | None; no role/credit mutation needed |
| Logout and anonymous access | Logout showed sign-in; reloading `/admin` redirected to sign-in without profile/admin data | None |
| Google re-login | First return stayed pending and reload showed the interrupted-login message; fresh retry subsequently completed, and a further reload retained the restored profile | Passed with an interrupted-attempt limitation; no latency guarantee |
| Email/password | Operator reported incognito login/logout completed using the requested email/password journey | Reported console regression corrected and browser-verified below; no identity reset |
| Runtime/dependencies/workers | [Corrective release 40176352821](https://github.com/Uniwares-LTD/unibase/actions/runs/40176352821) and [independent Check 40176659441](https://github.com/Uniwares-LTD/unibase/actions/runs/40176659441) succeeded for `215044b`; public readiness reports that source and both workers passed | None |
| Firebase helper/proxy | Same-origin helper configuration and Nginx trusted headers/unbuffered proxy reviewed; initial live Google login confirmed | Streaming behavior is configuration-reviewed, not a paid AI execution test |
| Isolated safeguards | Local 64 pure tests, TypeScript, web/worker build, focused lint/format and production HTTP header smoke passed. [PR validation 40176262861](https://github.com/Uniwares-LTD/unibase/actions/runs/40176262861) passed 186 account/service tests and 49 Linux deployment tests | Local Mongo-backed attempt stopped during its binary download; CI supplies the fresh coverage. Advisory limitations below remain |
| Operational access | Restricted routine Check succeeded; authenticated workstation has repository ADMIN access; pinned SSH using the documented local `srv1-ops-admin` key returned the expected operator identity | New devices still require the protected key handoff; no general sudo established |

The private [shared runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md#configuration-and-progress)
owns overall phase status, installed release/config identity and shared access.
Keep detailed app results here. Dated completed evidence remains valid until its
inputs change; do not rerun bootstrap or monitor Booklet to close app acceptance.
The Phase 2 shared-host baseline is already recorded. Recheck unrelated services
only when a new shared-host change could affect them.

**Console regression:** the operator reported the Cloudflare `email-decode.min.js`
CSP violation and React hydration error 418. Browser reproduction confirmed the
injected decoder and hydration failure on an authenticated account reload. The
correction in `215044b` adds `Cache-Control: no-transform` to private, no-store
document responses, preserving nonce/strict-dynamic CSP and immutable asset caching.
The production HTTP fixture and public response both preserve these headers. Fresh
authenticated account and administrator loads contain zero decoder scripts and
produce no new console errors. Retained errors from the previous document were
excluded by comparing the captured log baseline. Do not allow the decoder through
CSP or suppress hydration warnings. Cloudflare documents
[no-transform as an opt-out](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/#troubleshoot-email-obfuscation).

The CI artifact for the PR test merge of `215044b` reports passing environment,
docs, skill integrity, TypeScript, lint, formatting, pure/account/deployment tests
and shell checks. Advisory warnings remain for stale client translation sections,
dependency audit findings (one critical, 22 high, ten moderate across the audited
dependency set) and unavailable Actionlint. These were not suppressed or promoted
to deployment gates; dependency/tooling maintenance remains separate work.

**Procedure:** test Google and email sign-in, refresh, a harmless profile save/reload,
logout, protected-route denial and re-login. Restore any changed profile value.
Keep optional Dify/Stripe/MCP disabled; validate lease/retry/accounting and notification
duplicate prevention with isolated fixtures, never real charges. Existing worker
containers remain the runtime; endpoint/timer work is deferred.

**Failure/resume:** keep failed checks open and retain a sanitized error/request ID.
An interrupted Google flow may report a safe retry message after reload; retry from
Continue with Google, preserving normal storage/security protections. A repeatable
failure requires diagnosis, not declaring acceptance or clearing shared identities.
Use the [operations failure path](#operations) for runtime failures. No predecessor
means no image rollback; data restoration is never automatic.

**Completion:** all required app checks pass and an authorized operator can follow
the shared routine runbook without this conversation. Record remaining recovery,
Android, production and optional-provider limits separately; they are not Phase 3
completion claims.

### Follow-up recovery and consolidation

Keep the shared gateway, shared Redis/logical databases and app-hosted jobs as
explicit later milestones in the implementation plan. Preserve current workers
until the replacement is verified. Rename production to prod deliberately before
production activation; staging does not need that rename first.

The minimum manual backup/restore workflow is still **implementation required**.
Do not block a fresh first startup on its completion, but back up before destructive
operations/data migrations and complete off-host DB/GridFS restore rehearsal before
relying on recovery. Use a named disposable target; verify it is empty or take a
pre-restore backup. Keep partial/failed restores isolated and do not automatically
resume unhealthy writers. Shared Firebase identities and Dify are excluded.

Rehearse image/config rollback when a real compatible predecessor exists. Do not
manufacture a second release just for the runbook. Mark first deployment verified
separately from pending recovery/consolidation; track their next actions explicitly.

## Restricted first-staging control path

Infrastructure installs a reviewed Git archive under
`/opt/uniwares-control/<slug>/<bundle-sha256>`. Its shared deploy account sends only
versioned JSON selecting staging `deploy`, `check` or `rollback`; host script paths,
Compose files and credentials cannot be uploaded through that account. The request
must match the installed public-configuration hash and image repository. Application
image changes use the ordinary release workflow. Changes to host control scripts or
public configuration require a separately reviewed operator bundle update.

After host bootstrap and provider bindings, the trusted root operator runs the
installed `scripts/deploy/prepare-host.py --credentials <protected-file>` preview,
then the same command with `--apply --indexes`. Use `python3 -B` from the reviewed
root-owned bundle. The private JSON contains `firebase` (the existing service-account
object), `firebaseApiKey`, `firebaseAppId`, and the new app user's `mongodbUri`.
This command validates existing credentials, creates private runtime configuration
and optional additive indexes; it creates no cloud resources or app containers.
An interrupted identical setup resumes; differing existing configuration stops for
review. The credential input stays root-readable outside the source bundle.

Repository secrets for first staging: `DEPLOY_SSH_PRIVATE_KEY` (the separate
restricted key), `DEPLOY_SSH_HOST_KEY` (verified public host key), and
`CLOUDFLARE_READ_TOKEN` (owner-account Tunnel Read and zone DNS Read). The workflow
uses its own `GITHUB_TOKEN` to publish. No GHCR pull credential, Google OIDC
provisioner, Atlas administration credential or Firebase private key enters the
release build. Firebase credentials live in private host configuration.

The first GHCR publication can create a private package. Release stops before host
contact until the package owner explicitly makes it public, then the same release
can be retried. Anonymous digest pull is verified after publication. Record the
actual source SHA and digest; never substitute a mutable tag.

`Provision environment` no longer offers staging; `provision.sh staging` refuses
before credential or host access. `Setup VPS` is not the restricted staging bootstrap;
use Infrastructure's reviewed operator installer. Production provisioning and its
private-pull path are legacy, deferred interfaces, not staging instructions.

## Environment flows

| Environment | Entry point | Identity and services |
| --- | --- | --- |
| Local | `npm run dev` | Tracked local defaults, private overrides, Firebase Auth Emulator and local MongoDB; no cloud credentials |
| Staging | `_staging` push or manual Release | Shared staging Firebase account pool, app-specific web registration, database/user, Redis, Nginx port and Compose project |
| Production | `_prod` push or manual Release | App-specific Firebase project, database/user, Redis, Nginx port and Compose project |

All public hostnames use the existing host Cloudflare connector. Staging uses direct SSH to the verified VPS on port 22 with the restricted account.
The legacy production path still uses SSH Access and is not ready for activation. This project
does not create, reinstall, restart or own that connector or Dify Community.
`agentic-poc` remains their owner; its Terraform writes the complete tunnel route
list. The first staging route is a reviewed owner-side Terraform change. Unibase reads
live tunnel/DNS configuration and refuses a missing, shadowed or incorrect route;
it does not write Cloudflare configuration.

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
used, including for Android. Staging secrets use repository Actions secrets and private
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
- `ssh`: staging uses `transport=direct`, the verified VPS hostname and restricted
  user. Cloudflare transport also requires its pinned client version/checksum.
- `google`: shared staging project ID; distinct production project ID and explicit
  `organizations/ID` or `folders/ID` parent; OIDC provider resource and provisioner
  service-account email. `runtime.FIREBASE_PROJECT_ID` must match `google.projectId`.
- `atlas`: existing project/cluster, environment-scoped user and exact VPS egress
  address (`/32` for IPv4, `/128` for IPv6). No new cluster capacity is provisioned.
- `shared`: owner repository/ref, registered-route workflow, and existing
  tunnel/account/zone identifiers matching the owner registry.
- `ghcr.pullUser`: unused for staging public pulls; legacy production only.
- `android`: production wrapper hostname/package when Android delivery is needed.

Staging public bindings are populated from verified discovery; production remains
unconfigured. Validation names missing
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

### Configuration sources and credential preparation

GitHub Actions configuration variables are unused for application deployment.
Public settings are reviewed in `deploy/environments/*.json`; credentials must not
be committed there. Current staging uses repository Actions secrets
`DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_SSH_HOST_KEY` (verified public trust material),
and `CLOUDFLARE_READ_TOKEN`. GitHub supplies `GITHUB_TOKEN` for image publication.
Legacy production/optional workflows mention other secrets; they are not staging inputs.

The canonical [credential inventory and checklist](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/provider-access.md)
defines password-manager names, local exports, acquisition, permissions and rotation.
Use protected references, never chat-based secret handoffs. Preserve working filenames.

For new setup, prompt the operator to retrieve the initialization files from the
secure **Credentials** channel and provide only their protected local directory.
The shared inventory lists exact channel filenames and how to use them. Reuse
shared staging access, but create the child's Firebase web registration/database
user and rebuild its preparation bundle. The supplied `unibase-staging-*` files
are Unibase-specific, not child deployment credentials. Keep public configuration
in tracked environment JSON and public host trust in Infrastructure guidance.

Runtime credentials are currently on the VPS, **not runtime Actions secrets**.
`/etc/<slug>/staging/runtime.env` consumes `MONGODB_URI`, authenticated `REDIS_URL`
and Firebase web identifiers. Sibling `firebase.json` contains the Admin identity;
`redis-password` authenticates app Redis. Compose mounts Firebase JSON read-only and
sets `GOOGLE_APPLICATION_CREDENTIALS` to its container path. Releases retain private
snapshots. `FIREBASE_API_KEY` and `FIREBASE_APP_ID` are public browser identifiers.

Initial `prepare-host.py` expects a protected JSON object with exactly `firebase`
(Admin JSON object), `mongodbUri`, `firebaseApiKey`, `firebaseAppId`. It generates
Redis authentication on the host. It is not a general restore/update command:
existing networks/configuration may reject replay. Missing files require operator
review today. Runtime-secret restoration and automated initialization are
**implementation required**, with prerequisites and acceptance in the shared inventory.

### Publication and operator intervention

Every PR prepared for publication must include **Operator intervention: none**,
or list each action with owner, execution location, ordering relative to release,
verification and failure/resume instructions. An image-only change normally needs
no operator; root-owned control scripts, registered configuration, provider bindings,
credentials and data migrations require explicit impact assessment. An app image
cannot update the registered control bundle or provision resources.

A binding change must identify the operator/control update before release, owner
route change if needed, and checks before resuming. Where tooling is absent, say
**implementation required** with prerequisites and acceptance, not invented commands.
Publication alone does not prove live readiness or authorize data restoration.

### Derived-project deployment initialization

1. **Workstation / project owner:** run the README initializer from a reviewed
   committed revision with a unique identity. Explicitly select shared public
   connections with `--infrastructure-profile`; credentials are excluded. Review
   generated JSON, image namespace, database/user, paths, origin and suggested
   listener/subnet against current host inventory. Suggestions are not allocations.
2. **Workstation / agent and operator:** fill the shared credential checklist with
   protected references. Reuse shared deploy/staging Firebase keys and scoped
   Cloudflare read access; acquire app-specific web registration and MongoDB user.
   Collect missing inputs once. GitHub's secrets API cannot retrieve values; children
   inherit no source-repo secrets. Keep operator/provider administration access separate.
3. **Provider consoles/owner workflows:** register the web app in shared staging
   Firebase; configure authorized domain, sign-in and matching OAuth origin/redirect
   entries without removing existing apps. Create the app database user with scoped
   `readWrite` and approve destination egress. The existing tunnel owner adds the
   hostname pointing to private app Nginx. Leave optional integrations disabled.
4. **VPS / authorized operator:** for a new host establish operator access, pin host
   identity and install reviewed restricted tooling/compatible Compose. Existing
   hosts reuse shared accounts. Register the derived app's reviewed immutable control
   bundle/configuration and prepare private files/indexes. Do not replay historical
   Unibase root batches or copy its database, subnet or paths.
5. **GitHub / setup operator or authorized agent:** initialize the destination repo,
   enable public GHCR publication as needed and populate the three staging secrets
   from protected originals, preserving SSH key bytes. Setup uses individual reviewed
   operations today; a single initialization command is **implementation required**.
6. **GitHub Actions / application:** release a reviewed `_staging` revision through
   its own build → publish → anonymous digest pull → restricted deploy → health flow.
   Verify login/session persistence, database/Redis and both workers; record release
   identity and handoff. Inspect state and resume the failed checkpoint. A failed
   first release stops only its candidate, preserving config/data; no automatic DB restore.

**Production:** desired `_prod → prod` requires the pending compatibility milestone;
current tooling still uses `production` and legacy provisioning assumptions. Select
a separate Firebase project per application, production registration and separate
database/runtime credentials, allocations and recovery policy. Do not activate
`_prod` by copying staging secrets; verify the public-image/restricted path through
the separately reviewed production plan first.

**Relocation/recovery:** credentials do not recreate a host or data. Revalidate host
trust, control registration, networking, egress and tunnel bindings. Preserve the
old destination until acceptance and coordinated cutover. MongoDB/GridFS restoration
requires a separately tested recovery procedure.

Use repository Actions secrets for staging, as listed in
[the restricted control procedure](#restricted-first-staging-control-path).
Infrastructure owns the shared key/account bootstrap and protected credential
handoff. Do not create paid-plan GitHub environment secrets for this private repo.
Preserve the deploy key's complete OpenSSH file bytes, line breaks and final
newline. Upload the existing file through a byte-preserving `gh secret set` stdin
operation or paste it into the repository secret editor; avoid shell text encoding
conversions. A runner `error in libcrypto` before SSH authentication requires
checking secret serialization before changing the working server key.
The admin key stays outside routine workflows. Verify host-key material through
trusted operator access; do not use an unchecked scan as trust evidence.

## First provisioning

For staging, use the reviewed Infrastructure installer and the installed
`prepare-host.py` preview/apply procedure above. Reuse the shared Firebase key;
create only the app-specific Atlas user and add the required hostname through the
provider/tunnel owners. Root-owned configuration changes require an operator;
the deployment account cannot provision resources or upload code.

The historical production provisioner remains in source for a later compatibility
milestone. It still assumes Google OIDC administration, Atlas service-account
credentials, a registered-route interface and private GHCR pulls. It must not be
used for first staging. Production activation requires a separate reviewed plan;
no provisioner credentials or production resources are configured by this work.

## Operations

Pushes to `_staging` and `_prod` release automatically. Manual Release must select
the matching branch/environment. It guards branch/current remote commit before
building and again before host access, publishes a commit-tagged GHCR image (public for staging; legacy private production)
and deploys its immutable digest. Build/operational failures stop release; quality
reports remain advisory. No required quality branch checks are added.

Routine staging operations use the Check deployment and Rollback GitHub workflows
on `_staging`. The shared deployment account cannot run arbitrary `sudo bash` or
Setup VPS. Use the installed root-owned control checkout only for explicit operator
maintenance, as described above. The first release requires `prepare-host.py` and
additive indexes beforehand; directory setup alone is not provisioning.

Operations retain the existing app lock and repository Actions concurrency group.
Use runbooks to coordinate shared maintenance and provider domain changes; there is
no new cross-repository scheduler or host-wide orchestration system.

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

Use the [Phase 3 acceptance record](#phase-3--verify-and-hand-off) for current hosted
results and remaining checks. Earlier isolated tests are historical evidence, not
new live certification. Rehearse image/config rollback when a real compatible
predecessor exists; do not manufacture a release. Recovery and production activation
require their own reviewed scope and acceptance.

## Shared ownership follow-ups

- Transfer the shared tunnel to a dedicated infrastructure owner with Terraform
  state, route registry, credentials, locks and preservation of every SSH/app/Dify
  route. Avoid simultaneous route-list writers during handoff.
- Transfer Dify Community lifecycle separately, retaining installation version,
  private credentials, databases/storage, backups and service continuity. No
  reinstallation or provider activation is included in this change.
