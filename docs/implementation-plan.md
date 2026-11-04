# Implementation plan

This file holds this repository's accepted work and its current state. Accepted
milestones here authorize implementation without a new issue; everything else
follows issue policy. Keep it short: current behavior lives in
[architecture](architecture.md), operations in [deployment](deployment.md), and
dated evidence in Git history and pull requests, not here.

Derived projects start with an empty plan; the initializer replaces this file.

## Current state — 2026-11-02

Base is the reusable template (`template.json`, [CHANGELOG](../CHANGELOG.md)).
It provides accounts and English-only administration, credits and payments,
private files, notifications, rate limits, diagnostics, MCP, durable Runs with
Dify orchestrators, personas and saved artifacts, the project extension registry,
forward-only migrations, removable samples and history-preserving derived
projects. The staging installation runs the current `main`; see
[current staging release](deployment.md#current-staging-release).

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
provider actions or paid calls are part of this batch. T07-T08 are accepted for publication from `task/commerce-orders-promotions`.
They add atomic upfront orders, revision entitlements, prepaid Run binding and audited
refunds, plus versioned promotions, quota reservations and verified-payment benefits.
The affected commerce/wallet/Run/payment suites pass 78 tests; final review and build
evidence are recorded at handoff. [Service contracts](features/booklet-foundation/orders-promotions.md)
cover integration and provider boundaries.
T09-T12 commerce execution and T13 full integration remain subsequent tasks. Unitale T02 is accepted and merged.


- Accepted cross-repository implementation: reusable T01 commerce/measurement contracts are implemented and reviewed on task/booklet-foundation. Seven contract tests, typecheck, lint and application build evidence pass; two consecutive same-agent read-only review passes found no remaining blocking issues. Publication audit UID validation was corrected and regression-tested. Unitale owns the accepted PRD and T01-T28 graph in docs/features/booklet-generation. T02 is accepted in Unitale; T03-T06 implementation is described above. T09-T28 remain subsequent work. No provider publication, paid calls or release is authorized.
- Generic contracts are opt-in, strictly versioned and fixture-tested. They do not implement transactional billing, subscriptions, evidence retention or MCP transport. Existing records retain their prior parsers. Breaking additions need a new version; update strict consumers before emitting new fields.

### Template

- [ ] Checkpoint 5: make the Runs/Dify/personas/artifacts stack a removable
  sample. Accepted and deferred; the plan and resume point are in
  [template readiness](features/template-readiness/implementation-plan.md).

### Base installation

- [ ] Guided derived-deployment initialization acceptance and restricted
  runtime-secret restoration, following the shared inventory: validate
  destination identity, preserve conflicting files, resume safely and keep
  secrets out of logs and artifacts.
- [ ] Shared gateway: preserve the Firebase helper, trusted headers and streaming.
- [ ] Shared non-Dify Redis: allocate logical databases and adapt validation and
  readiness.
- [ ] App-hosted AI, events and maintenance endpoints and timers: retain leases,
  retries, accounting and notification duplicate prevention before removing
  workers.
- [ ] Production compatibility preserving retained snapshots, then a separately
  authorized production activation.
- [ ] Minimum manual backup and restore workflows, protected off-host storage and
  a disposable MongoDB/GridFS recovery rehearsal before relying on recovery.
- [ ] Image and configuration rollback rehearsal when a genuine compatible
  predecessor exists. Back up before destructive operations; never restore a
  database automatically on failure.
- [ ] Diagnostics follow-up: run the Redis limiter test against a disposable Redis
  and verify grant revocation in a browser with Redis.

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
