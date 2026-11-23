# Implementation plan

This file holds this repository's accepted work and its current state. Accepted
milestones here authorize implementation without a new issue; everything else
follows issue policy. Keep it short: current behavior lives in
[architecture](architecture.md), operations in [deployment](deployment.md), and
dated evidence in Git history and pull requests, not here.

Derived projects start with an empty plan; the initializer replaces this file.

## Current state — 2026-11-05

Base is the reusable template (`template.json`, [CHANGELOG](../CHANGELOG.md)).
It provides accounts and English-only administration, credits and payments,
private files, notifications, rate limits, diagnostics, MCP, durable Runs with
Dify orchestrators, personas and saved artifacts, the project extension registry,
forward-only migrations, removable samples and history-preserving derived
projects. The staging installation runs the current `main`; see
[current staging release](deployment.md#current-staging-release).

## Local Google popup sign-in

Implemented and merged in [PR #64](https://github.com/Uniwares-LTD/unibase/pull/64).
Local real-Firebase uses the hosted popup helper with the existing session exchange;
emulator/staging/production retain redirect behavior. The
[local popup plan](features/local-google-popup/implementation-plan.md) records verified
checks/reviews and exact Unitale consumption through its PR #14. Real Google sign-in
and the Unitale session were accepted by the user on 2026-11-21. No deployment/provider
change or Booklet checkpoint 10 implementation is included.

## Open work

### Booklet product foundation

T03-T06 are accepted and merged in Unibase PR #44; Unitale imported them in PR #3:

- T03: offline billing verification/publication/restoration fixtures and Android bridge contract.
- T04: durable admin MCP limits and extension private-tool authorization/discovery.
- T05: per-call measurements, private redacted evidence, idempotency and protected cleanup.
- T06: versioned draft/published catalogs, trusted product-type validators and immutable snapshots.

Use Handbook at `D:/Projects/handbook`, revision
`6205b01d94153824f02b678957ef51af18419015`, already supplied by the user.
Verification: 45 focused tests and 12 deployment configuration tests pass, as do
typecheck, lint, production build, environment, documentation, i18n and skill checks.
Final read-only review evidence is recorded at handoff. No live
provider actions or paid calls are part of this batch. T07-T08 are accepted and merged in Unibase PR #45 and imported in Unitale PR #4.
They add atomic upfront orders, revision entitlements, prepaid Run binding and audited
refunds, plus versioned promotions, quota reservations and verified-payment benefits.
The affected commerce/wallet/Run/payment suites pass 78 tests; final review and build
evidence are recorded at handoff. [Service contracts](features/booklet-foundation/orders-promotions.md)
cover integration and provider boundaries.
T09-T10 and their completion corrections are merged in Unibase PRs #46/#47;
Unitale imported the corrected foundation in PR #5. Live provider activation remains T28.
T11 Android purchases and T12 commerce administration are implemented and verified
on `task/commerce-admin-android`, pending acceptance/publication. On 2026-11-05,
the user-supplied Gradle 8.11.1 archive passed its official SHA-256 check. The
opt-in official `dl-ssl.google.com` Maven fallback resolves the previous 404 and
passes an offline repository-isolation check. SDK Platform 36 and Build Tools 35
were downloaded from Google's endpoints, checksum-verified and installed in an
isolated project cache. Full `:app:assembleDebug` succeeded (31 tasks); an offline
repeat succeeded with all 31 tasks up-to-date. APK inspection confirms the fixture
identity, minimum SDK 24, target SDK 36, custom payment activity and Billing Client
8.3.0. See [Android verification](android.md#verification-status) for artifact evidence.
Verification passes: 15 focused UI/service tests, 64 provider/commerce tests,
22 billing-compatibility tests and five Android/payment configuration tests;
typecheck, lint, production build, environment, docs, i18n and skill checks.
Browser verification covers real draft-save/publish, EN/AR at 1280px and 390px,
English/LTR admin, keyboard navigation, served-document CSP, and fake-native Play
quote/purchase gestures without Stripe fallback. These do not replace native or
T28 installed-device acceptance. T13 integration follows completion and publication
of T11-T12. Unitale T02 is accepted. Final review evidence is recorded at handoff.

- Accepted cross-repository implementation: reusable T01 commerce/measurement contracts are implemented and reviewed on task/booklet-foundation. Seven contract tests, typecheck, lint and application build evidence pass; two consecutive same-agent read-only review passes found no remaining blocking issues. Publication audit UID validation was corrected and regression-tested. Unitale owns the accepted PRD and T01-T28 graph in docs/features/booklet-generation. T02 is accepted in Unitale; T03-T06 implementation is described above. T11-T12 are implemented and locally verified, pending acceptance/publication; T13-T28 remain subsequent work. No provider publication, paid calls or release is authorized.
- Generic contracts are opt-in, strictly versioned and fixture-tested. They do not implement transactional billing, subscriptions, evidence retention or MCP transport. Existing records retain their prior parsers. Breaking additions need a new version; update strict consumers before emitting new fields.

### Template

- [ ] Checkpoint 5: make the Runs/Dify/personas/artifacts stack a removable
  sample. Accepted and deferred; the plan and resume point are in
  [template readiness](features/template-readiness/implementation-plan.md).

### Base installation

- [ ] Reusable backup and migration operations (#62): local implementation spans
  Unibase, Infrastructure and Handbook on task branches; see the
  [checkpoint evidence and contract](features/deployment-data-operations/implementation-plan.md).
  Manifest/status and checksum-preserving packaging, approved backup/migration,
  checked root recovery acknowledgment, exact-candidate Release gates/continuation,
  diagnostic/admin reads and optional shared skills are implemented. Final integrated
  verification/reviews are in progress. Publication, compatible controller/app-control
  installation, workflow pin/claim acceptance, recovery rehearsal and separately
  authorized staging acceptance remain gates. Production and the deferred manual
  host migration sequence remain inactive.

## Decisions in force

- Administration is English-only and keeps the user's public language preference;
  see [locale and direction](architecture.md#locale-and-direction).
- Each environment owns its Dify apps and managed MCP binding; see
  [Dify environment ownership](architecture.md#dify-environment-ownership).
- Diagnostic grants are durable in MongoDB with Redis counters only; see the
  [diagnostics API](diagnostics-api.md).
- Run result retention verifies original identities before renewing provider
  links and reports settlement retries as reconciliation; see [runs](runs.md).
- Template changes follow the [template readiness](features/template-readiness/prd.md)
  requirements: extensions in `src/project`, samples in `samples.json`, versioned
  releases with upgrade notes.
