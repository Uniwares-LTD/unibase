# AI setup, testing and extension guide

For the complete account/admin/payment/design regression and Base handoff, use
[the full test plan](test-plan.md). This page owns AI-specific configuration and limits.

## Local setup

Use the existing Firebase Auth and MongoDB replica-set emulator setup in README.
Keep real provider credentials out of local tests. Set `DIFY_MODE=fake` in
`.env.local`, then restart the web app and worker after configuration changes.

```sh
npm run db:indexes
npm run worker:build
npm run worker:ai
```

Run `npm run dev` in a separate terminal. Sign in with a verified local account
and obtain fixture credits through the existing simulated purchase flow. Open
`/ai`. With empty `AI_PRICING_JSON`, each example reserves one credit; successful completion consumes it.
The fake provider returns labelled simulated output and unknown monetary cost.

## Manual acceptance

1. Submit Text assistant, wait for completion and reload. The saved result and
   credit balance must persist. Inspect usage on the job detail page.
2. Start Conversation, complete a turn, then continue it. Start a new conversation
   separately. An unfinished turn must prevent a second concurrent turn.
3. Submit Document or image summary with a small text file or PNG. The uploaded
   reference belongs to this account and capability binding.
4. Open a job URL using a different account. Its inputs/results must be unavailable.
   A regular user must also be denied `/admin/ai` and its reporting/resolution APIs.
5. Stop the worker, submit a job, then restart the worker. The queued job completes.
   Cancel a queued job while the worker is stopped; after restart its hold releases.
6. Inspect `/admin/ai` with an administrator account. Fake usage must remain
   identifiable; missing tokens/costs must never be displayed as measured zero.
7. Check mobile navigation, keyboard operation and Classic/Glass/Soft Blue in light
   and dark modes. Use the confirmation dialog for manual credit release; Escape
   should close it and return focus to the trigger.

Provider uncertainty, credit races and crash recovery require deterministic tests;
the fast fake UI alone cannot reproduce them reliably.

```sh
npm test
npm run test:accounts
npm run build
npm run test:ai
npm run test:ai-pricing
```

`test:ai` requires the local Auth emulator and uses disposable MongoDB, synthetic
accounts, a production server and the bundled worker. It forces fake Dify mode.
`test:ai-pricing` uses the same isolated runner with variable policies. Run these
suites sequentially, also separately from account/payment HTTP suites on port 3101.
They do not contact Dify or spend real money. Build before running it. Do not run
development and build against the same `.next` directory concurrently.

## Live configuration

Set `DIFY_MODE=live`, `DIFY_BASE_URL` ending in `/v1`, and private
`DIFY_BINDINGS_JSON`. Each binding names a registered capability and contains
`revision`, `kind` (`workflow` or `chat`), and `apiKeyEnv` naming a private
`DIFY_KEY_*` variable. Optional `workflowId` checks the expected publication ID.
Use your own published apps and credentials; none are supplied by this repository.

The examples are `assistant-text` (workflow: `prompt` input, `text` output),
`document-summary` (workflow: `prompt` and `document` file-array inputs, `text`
output), and `assistant-chat` (chat: prompt becomes the message query). Their
default registered price is one application credit, unless overridden through
`AI_PRICING_JSON`. Provider monetary cost is separate.
The same private environment must reach the web process and AI worker. VPS Compose
includes the worker using the application image. Disabled mode requires no Dify
credentials. Live provider compatibility and deployment still need environment-
specific acceptance; local fixtures do not prove them.

## Adding product features

Register a named, versioned capability in `src/lib/server/ai/capabilities.ts` with
input/output validation, a server-controlled price and an optional file mapping.
Keep product schemas out of provider transport. Server feature services can create
jobs with a source reference `{ type, id, version }`; the generic public endpoint
does not let clients manufacture that reference or choose prices/credentials.

Use `prepare` to load and authorize feature input before dispatch. For chat
capabilities, prepared `prompt` becomes
the message query, optional `files` becomes the top-level attachment list, and all
remaining fields become Dify input variables (including named file variables).
Validate these fields in the capability and resolve local file IDs through the
owned-file mapping; clients must not supply raw provider references. The AI job
endpoint allows a 72 KiB JSON body, while stored inputs remain limited to 64 KiB
and the example prompt remains limited to 10,000 UTF-16 code units.

Use `materialize` for database-only result writes, passing its MongoDB session to every write and
checking the exact source version. Materialization, credit settlement and terminal
job state commit together. MongoDB may retry this hook: never perform network calls
or other irreversible side effects inside it. Saved provider results permit a
failed database transaction to recover without generating again. Administrator
acceptance uses the same hook. Preserve old capability versions while jobs remain.

Workflows, chat and uploaded-file references are implemented. Knowledge management,
audio-specific endpoints, human-input continuation and permanent generated-asset
storage can add feature/provider adapters through these boundaries. They are not
automatically implemented merely because Dify offers them. Product approvals and
domain-specific orchestration belong to downstream applications.

## Recovery, costs and retention

Jobs save dispatch intent before the provider POST and never automatically repeat
an uncertain generation. Worker leases last 180 seconds; provider POST attempts
are bounded to 120 seconds. Known executions are reconciled through reads. After
24 hours unresolved jobs escalate for review while credits stay reserved.
Stopping a provider task is a request, not proof that it stopped. Successful work
can win a cancellation race and still be charged.

Basic chat history can contain partial answers without reliable completion proof;
such evidence remains unresolved. Chatflows with a saved workflow identity can
use the workflow's terminal status. Administrator release is an audited credit
waiver and does not stop uncertain provider work or erase its possible cost.
An unresolved conversation may remain blocked; start a new conversation instead.
Drain work before disabling Dify or changing bindings. Pending jobs require their
original binding fingerprint; restore that configuration to reconcile them.

`aiUsage` stores deduplicated observations by job, scope and provider identity.
Costs use exact decimal strings and explicit currencies. Do not add execution
summaries to their node totals, mix currencies, or substitute credit price for
provider spend. Private job inputs/results live in `aiJobs`; diagnostic logs contain
safe categories and identifiers rather than prompts or provider response bodies.

Uploads allow at most 20 MiB per file and currently retain at most 100 references /
100 MiB per user across their lifetime. No automatic reclamation or deletion UI is
implemented. File bytes remain with the provider; these references are not a
permanent asset store. Configure provider retention separately and implement owned
private storage when a feature requires durable artifacts. Jobs, usage and file
references currently have no automatic expiry; define a reviewed retention policy
before broad production use, preserving billing and duplicate-execution evidence.

## Configurable credit pricing

Set `AI_PRICING_JSON` in `.env.local` (or the VPS runtime environment), then restart
both the web application and AI worker. Empty configuration retains the existing
fixed capability prices. These are synthetic examples, not recommended business rates:

```dotenv
AI_PRICING_JSON={"assistant-text":{"mode":"tokens","maxCredits":10,"rate":{"basis":"total","creditsPerMillion":"1000"}},"assistant-chat":{"mode":"hybrid","maxCredits":10,"baseCredits":1,"usage":{"mode":"provider-cost","currency":"USD","creditsPerCurrencyUnit":"400"}}}
```

Each capability accepts one of these policies:

```json
{"mode":"fixed","credits":1}
{"mode":"tokens","maxCredits":10,"rate":{"basis":"total","creditsPerMillion":"1000"}}
{"mode":"tokens","maxCredits":10,"rate":{"basis":"split","inputCreditsPerMillion":"500","outputCreditsPerMillion":"2000"}}
{"mode":"provider-cost","maxCredits":10,"currency":"USD","creditsPerCurrencyUnit":"400"}
{"mode":"hybrid","maxCredits":10,"baseCredits":1,"usage":{"mode":"tokens","rate":{"basis":"total","creditsPerMillion":"1000"}}}
```

Hybrid also accepts a `provider-cost` usage rule, as in the environment example.
Decimal rates must be nonnegative strings (up to nine whole and nine fractional
digits). Credits are whole integers up to one billion; variable maximums must be
positive and a hybrid base cannot exceed its maximum. Currency is an uppercase
three-letter code; there is no automatic currency conversion.

The UI shows the formula and maximum before submission. The maximum is reserved;
exact arithmetic calculates the successful task's charge, rounds up once after
combining all components, and caps it at that maximum. Settlement consumes that
amount and releases unused credits in the same transaction as the job result.
Unused expired promotional credits expire immediately. Confirmed failures and
cancellations release the hold without charging. Provider expenses can still exist
for failed tasks; the credit cap is a user-charge cap, **not a provider spending limit**.

Each job saves its pricing terms and billing evidence. Later rate changes do not
reprice it. API clients send the `pricingKey` supplied to the workspace alongside
the submission; stale/missing variable-price keys return 409 `AI_PRICE_CHANGED`.
Legacy fixed-price submissions without a key remain supported.

Billing uses only a completed run/message's reported summary. Node-level usage is
retained for reporting but never summed with overlapping run totals. Some Dify
workflow versions report total tokens but no summary monetary cost or split token
counts: use total-token pricing for these workflows. Missing required usage or a
currency mismatch leaves the job in `needs-review` with its hold intact. An operator
can release the hold with an audited reason; accepting a result still requires
sufficient billing evidence. The system never invents missing costs or charges the
maximum as a fallback. A zero configured rate does not need usage evidence.

### Local checks

With `DIFY_MODE=fake`, variable-priced jobs report synthetic 1,000 input tokens,
500 output tokens and USD 0.0025. They remain labeled fake; these are not actual
provider expenses. Fixed-price fake jobs retain the original unknown-usage fixture.

1. Use the example environment above and restart the app and worker.
2. Sign in with a local emulator account and grant/purchase at least 10 test credits.
3. Open `/ai`. Verify the formula and `up to 10 credits` before sending.
4. Submit a text task: 1,500 tokens at 1,000 credits/million costs **2 credits**.
   The completed job shows 2 charged, maximum 10; the remaining 8 are released.
5. Submit chat: base 1 + USD 0.0025 x 400 also costs **2 credits**.
6. Change a rate, restart, and submit from an old tab. Refresh is required before
   accepting new terms; existing jobs keep their saved terms.
7. To exercise review, configure provider-cost pricing with `EUR` against the fake
   USD fixture. The task requires review and retains its hold without charging.
8. Inspect `/credits` for commit/release entries and `/admin/ai` for fake usage.

Automated checks: `npm test`, `npm run test:accounts`, and (with the Auth emulator
running) `npm run test:ai-pricing`. The last command owns its disposable MongoDB,
production server and fake worker, and tests pricing consent plus exact settlement
through real HTTP. `npm run test:ai` verifies legacy fixed-price compatibility.
Live provider usage completeness still needs acceptance against your Dify app.
