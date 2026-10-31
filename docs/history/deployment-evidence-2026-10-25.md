# Historical deployment evidence through October 25, 2026

Historical evidence only. These instructions and identities are not current procedures or proof of current health. Use the parent deployment/operations guide.

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

See the [staging transition plan](../implementation-plan.md#shared-infrastructure-staging-transition--2026-10-22)
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
[restricted control](../deployment.md#restricted-first-staging-control-path). Historical preparation
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
Use the [operations failure path](../deployment.md#operations) for runtime failures. No predecessor
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
