# AI testing and operations

## Isolated local acceptance

Start Firebase Auth Emulator (`npm run emulators:auth`). Build with `npm run build`.
`npm run test:ai` starts a disposable MongoDB replica set and standalone app,
creates owned emulator users and runs the actual bundled AI/maintenance workers.
It does not load deployment credentials, use production services or reset your
local database. The fake orchestrator supports `decision`, `decision lost`,
`fail` and `partial` prompts for deterministic decision/reconciliation and outcome
fixtures. `npm run test:accounts` covers the durable job/credit/lease/provider,
private-file/storage and Runs boundaries. `npm test` covers pure contracts.

`node --conditions=react-server --import tsx scripts/integration.mjs --orchestrators`
checks read-only registration against a local Console/Service fixture in live
adapter mode. Existing-key and keyless workflows execute native outputs through
the bundled worker; checks include empty inputs, owned results, provider IDs,
input limits and exactly-once billing. Registration graph changes/publications must
remain zero. The Create scenario imports/publishes exactly one new app, retries
without duplicating it, then starts an owned zero-input Run, renders Generative UI,
submits a choice and verifies MCP/result tracing. Python is not required for these fixtures.
`--orchestrators --browser` exposes the fixture for desktop/mobile acceptance.
The fixture now verifies Disable, re-registration/Enable, Unregister, deleted-app
discovery and stale admission without new jobs or credit holds. History and
credentials survive removal. Account tests cover outages, incomplete/stale
catalogs, current revisions, recent administrator authority and concurrent
registration fencing. Browser checks cover the immediate post-register controls,
reload persistence and Delete registration on desktop/mobile. The browser harness
prints only its local fixture URL for simulating deletion; these endpoints never
exist in the application.

`node --conditions=react-server --import tsx scripts/integration.mjs --ai --dify-keys`
retains the broader fake-provider Runs regression and adds registration/key checks.
Focused account tests cover encryption, role checks, concurrent acquisition,
publication/input compatibility, Human Input delivery, MCP tool availability and
native output normalization. Removed graph-mutation services have no active tests.
Fixtures do not establish live Dify model/plugin/network acceptance.

Run `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:env`,
`npm run check:skills`, `npm run test:integration`, `npm run test:payments`,
`npm run test:health` and `npm run test:deployment` for repository checks. Quality
checks are advisory; production compilation/bundling failures remain build errors.
`npm run test:ai-pricing` exercises the same Runs HTTP suite; pricing modes are
exhaustively covered by isolated credit/provider tests instead of legacy chat UI.

For CLI browser verification, use the Playwright skill against the owned fixture:
`node --conditions=react-server --import tsx scripts/integration.mjs --ai --browser`.
Load `output/playwright/runs-state.json` into a named CLI browser session. The
fixture runs the real worker and remains available until Enter is pressed. Check
start, generated forms, reload/resume, failure recovery, history and Administration
at desktop/mobile widths, with keyboard navigation and all appearance/theme modes.
Inspect browser console/page errors and horizontal overflow. Capture artifacts
under `output/playwright/`; never commit session state or generated credentials.

## Configurable credit pricing

Configure global defaults at `/admin/settings`; per-orchestrator overrides are
retained for existing definitions; their editor is currently paused. Fixed, total/split tokens, provider-cost and
hybrid policies reserve the maximum at admission and settle once with exact
whole-credit rounding. Default fixed pricing is one credit per success and zero
on confirmed failure/cancellation. Free execution does not create a hold.
Verified-usage failure pricing excludes fixed/hybrid base charges and requires
trustworthy matching summary usage/currency. Missing usage leaves reviewable
reserved credit rather than inventing a charge. Changing configuration affects
new attempts and purchases; accepted snapshots remain unchanged.

## Administrator operations

`/admin/ai` shows usage and uncertain/blocked attempts. Accept only saved validated
successful outputs with adequate billing evidence. Explicit resolution/release
records administrator authority and explanation, releases credit and allows a new
attempt. It does not stop unknown provider work; the confirmation states this.
Cancellation remains pending until provider stop/final state is confirmed.

`/admin/operations` previews bounded terminal-content and failed-file cleanup.
The preview expires, requires an explanation/confirmation and rechecks exactly
those IDs. Active/uncertain jobs and changed records are skipped. Ownership,
financial, usage, audit and retry identities remain. Run image deletion uses
private-storage intents and the maintenance worker. Published Run images cannot
be treated as abandoned uploads. Provider files are not deleted automatically.
Cleanup defaults come from Base settings; execution remains an explicit admin
operation. There is no automatic local database deletion.

## Live Dify 1.17.1 acceptance

Use disposable test apps in the configured Dify workspace and follow
[dify/README.md](../dify/README.md). Verify:

- Console admin-key/workspace authentication, workflow discovery, one-click
  registration, key reuse/creation, native Start inputs, Human Input WebApp
  delivery and referenced MCP tool metadata. Verify no graph or publication writes.
- Published parent version pinning, zero/optional/required inputs, ordinary
  generation and business failure/partial result envelopes.
- A real MCP Tool invocation with returned revision/request ID, image bytes/private
  ownership, parent-mediated child questions and installed plugin/tool bindings.
- Sequential/parallel parent Human Input, matching end-user identity, continuation
  actions, expiry, stream drop/reconnect, split frames and paused snapshots.
- Lost dispatch/submission responses, worker interruption/lease fencing, cancellation
  races, provider summary usage and exactly-once settlement.
- Compatible diagnostic/checkpoint recovery after code/DSL changes; incompatible
  checkpoints require full restart and uncertain attempts require reconciliation.

Fixtures verify application behavior and pinned payloads; they do not prove a
specific self-hosted deployment's plugins, network or management permissions.
The starter was created, published and registered in the configured workspace.
Its real MCP call, Human Input form, continuation, Code result and native adapter
events passed. A real local Unibase HTTP Run using an owned emulator user also
passed Start, Generative UI, continuation, document result and one-credit billing.
The approved temporary MCP-only tunnel replaced the starter's offline connection;
other workflows/providers were not edited. This evidence covers the starter,
not image/child/model-plugin, parallel-human, failure/recovery or cancellation
acceptance above. Those remain pending. Fixtures alone do not establish live behavior.

## Verified implementation evidence

The Create correction passed 52 pure and 113 account/provider checks, production
web/worker build, typecheck/lint, owned HTTP and desktop/mobile Create/Run checks.
Live Unibase tracing includes Start, MCP fetch, human choice, composition and End.
Historical checks for the original Runs engine passed pure/account/provider suites,
owned HTTP execution, session/payment/health/deployment checks, production builds
and desktop/mobile decision/history flows. Current registration cleanup evidence
is recorded in [the implementation plan](implementation-plan.md). Removed setup
fixtures no longer establish current registration behavior. Live Dify acceptance
above remains pending beyond the verified starter scenario.
