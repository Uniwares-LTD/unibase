# Base implementation plan

Current state, 2026-10-25: the first staging release is running. Phase 1 preparation
and Phase 2 deployment are verified. Phase 3 staging authentication, operations
and documentation handoff are verified, including the corrective no-transform release. Production activation, Android/device acceptance and recovery
rehearsals remain separate. Do not repeat successful bootstrap or manufacture a
second release to demonstrate rollback.

Start with [setup](../README.md), [current architecture](architecture.md),
[application deployment and acceptance](deployment.md#staging-execution-and-acceptance)
and the private [shared runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).
The shared runbook owns the three-phase status table and installed release identity;
the application guide owns detailed acceptance. Update those records rather than
copying changing status or image digests into this plan.

## Shared handbook onboarding — 2026-10-26

The accepted onboarding change adds four-hour lazy handbook checks, setup/doctor
commands and six shared skill entrypoints. Existing accepted milestones below retain
their authority without retroactive issues; new substantial work uses handbook issue
policy. Application architecture, deployment permissions and local skill adaptations remain
owned here. The 2026-10-27 reconciliation uses eleven shared entrypoints, adds a local
source map and explicit Codex/Claude synchronization after Handbook PR #3 merged. See [agent tooling](agent-tooling.md) for setup, validation and client limits.
The 2026-10-28 reconciliation adds the twelfth entrypoint (maintain-docs), consumer-owned
tracking and confirmed repository preferences, client safeguards and permissive templates.
No backlog migration or deployment is part of this change.

## Proposed extension: staging diagnostics API — 2026-10-28

Implemented and locally verified. The required issue draft awaits human approval, and this is not yet an accepted milestone. The work adds Redis-backed, expiring operator grants from Base settings and `POST /api/diagnostics`, with read-only capabilities across every module. It also records typed sub-reasons behind `private-context-unavailable` on new attempts, and AI workers now report their configuration checks with heartbeats. See [diagnostics API](diagnostics-api.md).

The three staging diagnostic indexes were installed and verified on 2026-10-29.
The authorized configuration follow-up selects diagnostics in tracked environment
JSON (staging true, local/production false). The first implementation incorrectly
required a v2 host controller, and release `62d8ac5` was refused before replacement.
The compatibility fix retains v1 and ships an allowlisted application flag map in
the image, preloaded before web/worker startup. No controller installation is
needed for the existing staging host. [Corrective release 40829051847](https://github.com/Uniwares-LTD/unibase/actions/runs/40829051847)
and [independent check 40829410729](https://github.com/Uniwares-LTD/unibase/actions/runs/40829410729)
passed on 2026-10-29. Public readiness reported the corrective revision, Home and
Account returned 200, and diagnostics returned 401 without a grant, confirming
enablement with authentication enforced. Authenticated read-only grant access was
verified on 2026-10-29 across capability listing, runtime/dependency health, workers,
configuration, Run diagnosis and sanitized access auditing; all returned 200.

The failed Unitale investigation confirmed a current configuration blocker: the
staging Dify MCP client lacks `run:read`, `artifact:read` and `artifact:write` in
both web and the active AI worker. The tracked permission correction is authorized
and prepared. Protected host-profile installation, matching release, Dify catalog
refresh and one owned Run restart remain live acceptance steps; the old failed
attempt's detailed historical cause was not recorded.

Outstanding: approve and publish the issue; run the Redis limiter test against a disposable Redis; verify grant revocation in a browser with Redis; and complete the Unitale permission correction's operator installation and live Run acceptance.

## Accepted diagnostic grant usability and persistence ? 2026-11-01

The accepted follow-up removes manual phrases, returns one-time server-generated
access details in a copy dialog, adds seven- and thirty-day durations, and makes
MongoDB authoritative while retaining Redis rate limits. Existing Redis grants
will deliberately require one replacement after the switch; no migration is included.
Local verification: 23 diagnostics checks passed with one optional real Redis
limiter check skipped because Docker's engine was unavailable; all 71 general
tests, type checking, lint, environment/docs/i18n/skill checks and production build
passed. English/Arabic desktop and 390px browser checks passed with mocked grant
responses and disposable authentication/MongoDB: copy, clipboard rejection/manual
selection, focus, credential cleanup and hydration. MongoDB tests verified scope,
exact expiry, concurrent limits, replacement store/limiter instances and outages.
A separate read-only review checked credential disclosure, audit/revocation behavior,
translations and rollout guidance. Publication, additive index installation,
real Redis recreation and live acceptance remain separate.
See [diagnostic rollout](diagnostics-api.md#durable-grant-rollout).

## Accepted English-only administration — 2026-11-01

Administration now uses English source copy rather than locale catalogs, including
navigation, metadata, confirmations, diagnostic access, state/field labels and
administrative API/action errors. Removed 357 unused administrative UI keys from
both English and Arabic catalogs, plus administrative fields, actions and states.
Shared public-page translations remain available. Admin presentation is English/LTR
without changing saved public language/timezone or offline language preferences.

Local verification: all 73 unit tests and 10 isolated HTTP integration tests passed;
type checking, lint, production build and documentation/i18n/skill checks passed.
Browser verification covered all eight admin sections at 1280px and 390px with an
Arabic profile/cookie, user details, confirmation/copy dialogs, English admin and
Arabic public API errors, server-rendered lang/dir and client navigation restoring
Arabic/RTL. Grant creation responses were mocked; authentication and MongoDB were
disposable. No hydration/translation errors were detected. A separate read-only
review checked the final change. Publication/deployment remain separate.

## Agreed decisions

### Completed Unitale result retention — 2026-11-01

The recurring completed-but-Running case was reproduced as expired Dify image
signatures. Recovery now verifies original Run/file identities and the bundled
Code validator before renewing missing links, preserves staged owned bytes, renews
the worker lease during retention and reports settlement retries as reconciliation.
Local verification: 47 affected worker/accounting, Dify, media and renewal tests,
type checking, lint, documentation/translation/skill checks and build passed.
One original staging image was renewed and downloaded without invoking a model;
the [staging release and independent check](deployment.md#current-staging-release)
passed. Fresh diagnostic access confirmed the original attempt succeeded with nine
distinct retained images and one two-credit settlement at 09:21:55 UTC. The hold
is committed; recovery preserved the original provider execution without generation.
See [release impact](deployment.md#completed-run-image-recovery-release-impact).

The follow-up artifact attachment retry also failed while all nine Run images
remained ready. Its old application record did not retain the underlying error.
The correction stages payload copies within MongoDB before the short metadata
transaction, validates expected images, and records sanitized failure codes/phases.
Sixty affected tests passed with one optional Redis test skipped; type checking,
lint, documentation/skill checks, build and separate read-only review passed.
Command-monitoring tests verify nine large images publish without image bytes in
transaction requests or responses. After the authorized staging release and
independent check, an owner-initiated retry was verified as `applied` with nine
promoted images and the original two-credit charge unchanged. The earlier save
failure's exact historical cause was not recorded. See the deployment acceptance
record above; production activation remains separate.

### Accepted extension: environment-owned Dify apps — 2026-11-01

One app per project/environment, automatic managed MCP setup, exact-version copying,
visible ownership and registration/admission guards are implemented in the working tree.
Existing unmanaged registrations are removed manually; no migration or production
activation is included. Local verification: 215 account tests passed with one optional
Redis test skipped; the 59 affected checks also passed after review hardening, along
with 70 general tests, type checking and production build. English/Arabic desktop
and 390px browser checks used an isolated account and mocked Dify management responses.
Environment/docs/i18n/skill checks and lint passed. Fourteen Python deployment checks
passed; cross-repository parity was skipped without Infrastructure, and the complete
Linux deployment runner could not start because Docker Desktop's engine was unavailable.
Separate read-only review checked the final implementation; publication, operator/control
preparation and fresh local/staging live acceptance remain separate. Paid execution
needs separate authorization. See [environment binding](mcp.md#environment-owned-dify-apps).

Valid verified sessions authorize application and administrator changes throughout
their normal lifetime, without a separate 30-minute mutation cutoff. Current-role,
suspension and revocation checks remain mandatory; creating a new Firebase session
cookie retains its token-exchange freshness check and five-day session lifetime.

One Next.js App Router application serves web/PWA and the prepared Android TWA.
Firebase authenticates users; MongoDB owns application profiles, roles, Runs and
accounting. Server modules enforce permissions. Configuration and public module
selection come from `project.config.json`; private credentials stay server-side.
See [service contracts](services.md) for ownership, accounting and retry invariants.

Applications deploy independently. `main` is development; `_staging` targets
`staging`; `_prod` will target `prod` after deliberate compatibility work. Existing
production tooling still uses `production`; `NODE_ENV=production` is unchanged.
Keep current app workers, Redis and private Nginx until replacements are verified.
Quality checks are advisory; build and operational failures retain real failures.

## Milestone overview

| Milestone | Current state | Outstanding acceptance |
| --- | --- | --- |
| M1 Application foundation | Implemented and locally verified | Revalidate affected UI after changes |
| M2 Authentication/profiles | Implemented; staging acceptance verified | Revalidate affected journeys after changes |
| M3 Diagnostics/PWA/Android | Web/PWA locally verified; wrapper/workflow prepared | Android configuration, GitHub Free workflow compatibility, compilation and device/domain checks |
| M4 Deployment | First staging release and restricted Check succeeded | Later recovery/rollback rehearsal; production compatibility and activation |
| M5 Integrated handoff | Staging Phase 3 verified | Broader Android/production/optional-provider acceptance remains separate |

## Shared infrastructure staging transition — 2026-10-22

Follow [application acceptance](deployment.md#phase-3--verify-and-hand-off) and the
[shared runbook](https://github.com/Uniwares-LTD/infrastructure/blob/main/docs/operations.md).
Phase 1 and Phase 2 are complete. Source, digest, installed control bundle and
configuration identity belong in the shared runbook; dated application acceptance
belongs in the deployment guide. Provider bindings and the non-overlapping app
subnet are installed, not merely candidates.

### First working staging deployment

- [x] Reviewed preparation, repository secrets, public anonymous image pulls,
  restricted shared deployment account and owner-managed tunnel route.
- [x] Compatible Compose/Buildx, private runtime configuration and additive indexes;
  first release plus independent staging checks.
- [x] Phase 3: Google admin/session/profile/logout/re-login, operator-reported
  incognito email login/logout, runtime checks and operator access verified.
  Cloudflare rewriting/CSP hydration regression corrected, deployed and browser-verified.
  Canonical operations and guidance consolidated; remaining limitations are explicit.

### Later consolidation and recovery

- [x] Staging AI activation: separate Dify app and authorized staging MCP connection,
  retained encryption/execution credentials, reviewed operator update, registered
  published workflow and bounded Dify/Persona live acceptance verified. Persisted
  results and credit settlement are recorded in deployment guidance. Confirmation
  of secure-channel storage remains outstanding; fresh derived deployment is separate.

- [ ] Guided derived-deployment initialization acceptance and restricted runtime-secret
  restoration: follow the shared inventory; validate destination identity, preserve
  conflicting files, resume safely and prevent secrets in logs/artifacts. Current
  operator preparation is not a restore interface.

- [ ] Shared gateway: preserve Firebase helper, trusted headers and streaming.
- [ ] Shared non-Dify Redis: allocate logical DBs and adapt validation/readiness.
- [ ] App-hosted AI/events/maintenance endpoints and timers: retain leases,
  retries, accounting and notification duplicate prevention before removing workers.
- [ ] Production-to-prod compatibility preserving retained snapshots, then a
  separately authorized production activation.
- [ ] Minimum manual backup/restore workflows, protected off-host storage and
  disposable MongoDB/GridFS recovery rehearsal before relying on recovery.
- [ ] Image/config rollback rehearsal when a genuine compatible predecessor exists.
  Back up before destructive operations; never automatically restore a DB on failure.
- [ ] Image retention and any legacy gateway/service ownership migration as
  separate reviewed work; no broad cleanup or Docker Engine upgrade here.

## M1 Application foundation and development conventions

Implemented and locally verified. Current patterns live in [architecture](architecture.md)
and [design-system guidance](design-system.md); setup commands live in the README.

## M2 Authentication and MongoDB profiles

Implemented with Firebase server sessions, verified identities, MongoDB ownership,
CSRF/origin checks and isolated emulator tests. Current account procedures live in
[local testing](local-testing.md); hosted results live in [deployment acceptance](deployment.md#phase-3--verify-and-hand-off).

## M3 Diagnostics and Android delivery

Web diagnostics/PWA are implemented. Android remains prepared, not certified:
complete package/hostname/signing configuration, compilation and device acceptance
using [Android guidance](android.md) and [M3 checks](m3-testing.md).

## M4 VPS deployment and advisory quality checks

Staging is deployed through its own reviewed release workflow. Routine operations
use the restricted account; root-owned control/configuration changes require an
operator. Use [deployment guidance](deployment.md) and the shared runbook.
Production provisioning is a legacy interface requiring compatibility work.

## M5 Integrated verification and team handoff

Complete Phase 3 against the application acceptance record, with useful operator
instructions and honest remaining limits. This does not certify Android,
production, optional paid integrations or off-host data recovery. Use isolated
fixtures for financial/retry/security regressions; do not test against production.

## Historical checkpoints

The [dated evidence archive](history/implementation-evidence-through-2026-10-25.md)
preserves the original milestone requirements, detailed local/provider trials,
verification scope and historical failures. The forwarding headings below retain
existing document anchors. They are references, not pending implementation tasks.

## First-admin initialization — 2026-10-24

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#first-admin-initialization--2026-10-24).

## Saved-artifact live regression and recovery — 2026-10-24

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#saved-artifact-live-regression-and-recovery--2026-10-24).

## Unitale completed-result recovery — 2026-10-24

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#unitale-completed-result-recovery--2026-10-24).

## Unitale image-model recovery — 2026-10-24

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#unitale-image-model-recovery--2026-10-24).

## Unitale Persona draft trial — 2026-10-24

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#unitale-persona-draft-trial--2026-10-24).

## Agent skills and guidelines to import

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#agent-skills-and-guidelines-to-import).

## External inputs and activation boundaries

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#external-inputs-and-activation-boundaries).

## What complete implementation provides

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#what-complete-implementation-provides).

## Product extension: admin and credits

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#product-extension-admin-and-credits).

## Migration preparation checkpoint

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#migration-preparation-checkpoint).

## Design-system checkpoint (before concept migration)

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#design-system-checkpoint-before-concept-migration).

## Switchable appearance presets

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#switchable-appearance-presets).

## Source references

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#source-references).

## Soft Blue and Glass page artwork

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#soft-blue-and-glass-page-artwork).

## Richer Glass presentation

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#richer-glass-presentation).

## General AI foundation before content migration

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#general-ai-foundation-before-content-migration).

## AI pricing extension

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#ai-pricing-extension).

## Base documentation and acceptance handoff

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#base-documentation-and-acceptance-handoff).

## Review fixes and administrator operations

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#review-fixes-and-administrator-operations).

## Retired creation workspace extension

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#retired-creation-workspace-extension).

## Accepted extension: reusable MCP tools

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-extension-reusable-mcp-tools).

## Clone-readiness audit — 2026-10-10

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#clone-readiness-audit--2026-10-10).

## Accepted replacement: Dify orchestrator Runs - 2026-10-10

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-replacement-dify-orchestrator-runs---2026-10-10).

## Accepted extension: personas, Run-scoped MCP and persistent artifacts - 2026-10-12

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-extension-personas-run-scoped-mcp-and-persistent-artifacts---2026-10-12).

## Accepted reuse and service-hardening extension - 2026-10-13

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-reuse-and-service-hardening-extension---2026-10-13).

## Accepted environment configuration and provisioning extension ? 2026-10-14

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-environment-configuration-and-provisioning-extension--2026-10-14).

## Accepted reuse verification and simulated Unitale preview — 2026-10-18

See [historical requirements and evidence](history/implementation-evidence-through-2026-10-25.md#accepted-reuse-verification-and-simulated-unitale-preview--2026-10-18).

## Accepted deployment reliability follow-up

The accepted plan adds staging host preflight before image publication, sanitized
compatibility diagnostics and an advisory PR host-configuration impact report.
Infrastructure owns protocol/installation and its separate Handbook adoption;
Unibase owns release integration. Local implementation is not operator installation
or live acceptance. See [early compatibility](deployment.md#early-host-compatibility-check).
The issue-ready Unibase outcome is "Check host compatibility before publishing
releases", related to Infrastructure's adoption and preflight outcomes. New issue
creation remains subject to approval; accepted work does not require retroactive issues.

## Accepted extension: repeatable approved deployments

The accepted delivery order is: (1) declarative configuration, projected immutable
bundles and locked execution; (2) version-2 plans, Infrastructure-admin OIDC approval
and resumable fixed operations; (3) production compatibility and manual encrypted
off-host recovery; (4) derived-project setup and consolidated operations guidance.
Both promotion branches originate from main. Production activation, publication,
host installation and issue creation retain separate authorization.

Local implementation now includes the projected bundle builder, version-2 locked
clients, durable plans/checkpoints, pinned Infrastructure OIDC approval, production
mapping, manual restic recovery, candidate reuse and initializer integration. Both
repositories retain v1 compatibility for unmigrated applications. Production remains
unconfigured and inactive. Subsequent installation, release, provider changes and issue
creation retain separate authorization; completed work is recorded below.

Acceptance: disposable Linux filesystem tests cover actual archive/updater/dispatcher
agreement, locks, rejection, restoration and approval boundaries. Service/provider
commands are synthetic. Controller installation, protected readback, configuration correction and routine
staging release/check are verified. Real GitHub OIDC claims, MongoDB/restic restore
rehearsal and protected-plan live acceptance remain rollout checks; passing source tests does not satisfy those checks. The selected
Infrastructure Admin team is enrolled by reviewed numeric IDs, not automatic ongoing
membership synchronization. Project #2 verification still needs read:project.

## Accepted image retention and deployment disk protection ? 2026-10-31

Implement capability-bound requests, pre-pull and pre-replacement disk checks, shared image-lock handoff, successful-activation ledger integration and separate maintenance reporting. Infrastructure owns the policy, cleanup and timer; derived projects receive enrollment proposals only. Local/CI verification and a separate read-only review precede handoff. The authorized one-time cleanup, host installation and staging release/check are verified; production activation and timer enablement remain pending and separate. See [image retention](deployment.md#image-retention-and-disk-headroom). Related issue-ready outcomes are Infrastructure retention/controller tooling and Unibase integration; no issues are created by this milestone.


## Deployment documentation reconciliation — 2026-10-31

[Current staging release](deployment.md#current-staging-release) owns source/image and workflow acceptance. Infrastructure owns installed identities and dated capacity. Web, both workers and public readiness passed; Dify functional acceptance is pending. Historical account/provider acceptance was not rerun. This documentation change requires no installation or deployment.
