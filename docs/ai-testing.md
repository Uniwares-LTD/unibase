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
optional at `/admin/orchestrators`. Fixed, total/split tokens, provider-cost and
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

## Live Dify 1.17.1 acceptance ? pending

Use disposable test apps in the configured Dify workspace and follow
[dify/README.md](../dify/README.md). Verify:

- Console admin-key/workspace authentication, discovery, metadata, availability,
  missing keys, secret-excluded DSL export, new-app import, overwrite confirmation,
  pending import warnings and uncertain mutation journal behavior.
- Published parent version pinning, initial input/correlation fields, ordinary
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
No live instance was supplied for this implementation. Keep this acceptance
pending until the disposable apps are exercised. Do not mark fixture success as
live provider acceptance.

## Verified implementation evidence

On 2026-10-11, 51 unit and 82 account/provider tests, owned Runs HTTP acceptance,
9 account/session HTTP tests, 3 payment HTTP tests, health checks and 25 isolated
deployment tests passed. Production web/worker builds, typecheck, lint, formatting,
environment and skill integrity checks passed. Docker runtime/DSL packaging and
Playwright desktop/mobile decision, reload, recovery, history and Administration
checks passed. Full account fixtures used two concurrent test processes to avoid
Mongo startup deadlines while builds were running. Live Dify acceptance above
remains pending.
