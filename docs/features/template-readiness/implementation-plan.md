# Template readiness implementation plan

## Contract and decisions

Requirements: [PRD](prd.md). No issue: the user accepted the plan in session on
2026-11-02 and declined none of the checkpoints. Branch `task/template-readiness`
from main `b32ff2b`. Handbook baseline `a2de13d7fb2e859ae85ac7d7bf7ff2356eaccba4`.

## Execution prerequisites

Node 24, installed dependencies, local MongoDB memory server for store tests.
Commits, pushes and PRs need explicit session authorization.

## Checkpoints

### 1. Template versioning (R1)

- `template.json` with version and changelog link; `CHANGELOG.md`; the initializer
  records `templateVersion` in `project.source.json`; validate reports drift.
- Acceptance: unit test for the changelog check; initializer test asserts the
  recorded version.
- Continuation: automatic.

### 2. Extension registry (R2)

- `src/project/index.ts` exports `defineProject(...)`; core lists become core
  entries plus contributed entries. No persisted identifier changes.
- Acceptance: a test definition appears in navigation, admin sections, MCP catalog
  and index setup, and module/permission filtering still applies.
- Continuation: automatic.

### 3. Database migrations (R3)

- `migrations` collection, `control` lock, namespaced IDs, checksum refusal;
  domain-reference migration becomes `core:0001`; provisioning runs migrations.
- Acceptance: disposable-database tests for order, rerun, checksum mismatch,
  concurrency and partial failure.
- Continuation: automatic.

### 4. Reference feature (R4, R5 mechanism)

- `src/samples/notes`, `samples.json`, `samples:remove`.
- Acceptance: feature tests; removal leaves a passing build and test suite.
- Continuation: automatic.

### 5. Runs stack as samples (R5)

- Move Runs, Dify, personas, artifacts and Unitale code behind registry hooks;
  core keeps reading historical credit and notification records.
- Acceptance: with samples, existing Runs/Dify tests pass; without them, build,
  core tests and historical-record reads pass.
- Continuation: automatic.

### 6. History-preserving initializer and updates (R6)

- Clone with history, one initialization commit, `upstream` remote, removed
  samples recorded; `template:update`; runtime display names replace text rewrites.
- Acceptance: local-fixture test creates a project, adds a feature, merges a
  template change and builds.
- Human gate: creating real repositories needs separate authorization.

Each checkpoint needs two consecutive clean read-only reviews; the last covers the
integrated diff against `b32ff2b`.

## Verified progress and resume

- Checkpoints 1 and 2 complete (2026-11-02). Typecheck, lint, unit tests (78),
  account tests, check:docs, check:template, check:i18n and build pass. The
  account `ai-pricing` "failed required materialization" test also fails on
  main `b32ff2b`. Account tests need the host's `MCP_CONNECTION_NONBLOCKING`
  unset: application environment validation rejects unknown `MCP_` names.
  Reviews: first passes found the load-time domain cycle, route overlaps,
  dependency gating, admin collisions and initializer validation; fixed and
  re-reviewed.
- Checkpoint 3 decisions: migration IDs are `<owner>:<NNNN>-<name>` with the
  owning module as owner (the domain-reference migration is `runs:0001`);
  changed checksums are reported, not refused; provisioning runs migrations,
  later releases run them through the upgrade notes.
- Next: checkpoint 3.
