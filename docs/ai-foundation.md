# Reusable AI execution foundation

Status: foundation implemented and locally verified on 2026-10-05; configurable
pricing verified on 2026-10-06 (see the implementation plan). Live Dify compatibility
and VPS deployment require environment-specific acceptance; neither was performed.

## Outcome and boundaries

Provide a reusable Dify integration in the existing Next.js application before
the content migration. Keep accounts, authorization, credits, jobs, durable results
and usage in Base; keep model/prompt/workflow configuration in Dify. Do not add
product schemas, copy source-project workflows, call production providers or deploy this work.

Change-surface forecast: server-only provider and execution modules, MongoDB
collections/indexes, credit reservation lifecycle, owned HTTP endpoints, worker
build/runtime/deployment configuration, environment validation, tests and setup
documentation. Existing theme, Firebase identity and payment contracts stay intact.
The material risks are uncertain provider acceptance, worker restarts, concurrent
credit settlement, ownership, provider version differences and missing cost data.

## Checkpoints

- [x] A1: capability configuration, bounded provider transport, streaming workflow
      identity/results, safe errors, files and chat interfaces, local fake provider.
- [x] A2: owned durable jobs with idempotency fingerprints, immutable binding
      snapshots, leased dispatch/recovery, cancellation and operator resolution.
- [x] A3: atomic credit reservation/job creation and result/credit settlement;
      durable deduplicated usage and costs, owner/admin reporting.
- [x] A4: usable local test surface and worker, environment/deployment integration,
      documented extension contracts and test instructions, affected verification
      and a separate read-only review.

All checkpoints are required for completion. A transport alone is not a working
execution service. The content migration plan remains separate.

### Current implementation evidence

The working tree now contains workflow transport, bounded SSE parsing, capability
registration, a fake text workflow, transactional owned jobs/managed credit holds,
lease-fenced recovery, deduplicated `aiUsage`, an AI worker entry, owner job APIs
and administrator usage/resolution APIs. Results are not returned to owners until
successful credit settlement. Operator release is audited and requires an explicit
acknowledgement that an uncertain provider execution may still run.

Implemented surfaces also include owned file uploads and chat conversations,
owner/admin UI, a Compose worker service, deployment environment validation and
transactional feature materialization hooks. Setup, manual checks, supported
extension points and retention limits are documented in [AI testing](ai-testing.md).

Verification on 2026-10-05: 40 unit tests and 53 account/provider tests passed;
the subsequently expanded 12-test job suite also passed. TypeScript, ESLint,
environment/skill-integrity checks, seven deployment-config tests and the production
build (including both worker bundles) passed. AI, authentication and payment HTTP
integration suites passed with isolated local fixtures; the AI suite was repeated
after the final worker correction. Browser checks covered text tasks, reload,
chat follow-ups, document uploads, usage and audited administrator release, plus
desktop/mobile navigation, keyboard dialog focus and all appearance presets.

The separate read-only review found and corrected late chatflow identity
persistence and indefinite retries of failed feature materialization. Regression
tests passed; the subsequent read-only pass found no remaining actionable defects.
The implementation matches the forecast: one Next.js app, MongoDB and a separate
worker process; no product schemas, additional infrastructure or cloud resources.

| Requirement                   | Implementation and verification evidence                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reusable provider boundary    | `config/dify.ts`, `ai/dify.ts`, `ai/chat.ts`, `ai/files.ts`; configuration, SSE, response-limit, identity and error tests                       |
| Owned durable execution       | `ai/jobs.ts`, `ai/service.ts`, `ai/worker.ts`; cross-user HTTP tests, concurrent submission, lease fencing and recovery tests                   |
| Credits and provider costs    | Managed holds in `store/credits.ts`, durable `aiUsage`; exact-decimal, deduplication, rollback, reversal and cancellation-race tests            |
| Future feature integration    | Versioned capabilities, source references and prepare/materialize hooks; transactional rollback/recovery and permanent-failure escalation tests |
| Usable local/deployment setup | `/ai`, `/admin/ai`, worker bundle, Compose/environment validation, fake HTTP/browser flows and [testing guide](ai-testing.md)                   |

Future features reuse these boundaries but still implement their own contracts,
provider operations and product behavior. This acceptance does not claim every
Dify endpoint or every future application is already implemented. Retention and
provider-file limitations are explicit in the testing/extension guide.

The registered text example accepts `{ "prompt": "..." }` and requires an output
object with a `text` string. Its default fixed price is one application credit;
`AI_PRICING_JSON` can override it. Fake output is labelled simulated: fixed-mode
usage is unknown, while variable modes supply documented synthetic usage fixtures.
No fake execution contacts a provider or incurs real model cost.
Current owner endpoints are `POST/GET /api/ai/jobs` and
`GET/DELETE /api/ai/jobs/{id}`. POST requires `{ key, capability, inputs }` plus the current `pricingKey` for
variable pricing (the UI sends it for every mode), uses
the existing session/CSRF checks and returns an accepted durable job. The worker
runs separately through `npm run worker:build` then `npm run worker:ai`.

## Contracts and invariants

- Capabilities have stable names and explicit versions. Only server registrations
  decide input/output validation, pricing and allowed operations. Browser callers
  cannot choose credentials, provider URLs, ownership or credit prices.
- `DIFY_MODE=disabled|fake|live` defaults to disabled. Fake mode needs no provider
  credentials and makes no external calls. Live bindings come from private runtime
  configuration; no keys are stored in job snapshots or public DTOs.
- A provider adapter handles workflows, chat and files without importing product
  schemas. Workflow-backed text/image/multistep features use the same execution
  service. Product approval and orchestration remain feature responsibilities.
- Support is explicit, not a promise to implement every future Dify endpoint.
  Paused and partial-success workflows must be represented honestly. Knowledge,
  audio and newer provider operations can add adapters without changing ownership,
  job identity or billing contracts; unsupported operations must fail explicitly.
- Use a stable opaque provider user per application user. Independently enforce
  Base ownership for jobs, conversations, input files and returned artifacts.
- Persist dispatch intent before sending. Never automatically repeat a generation
  POST after an uncertain response, a crash or loss of a lease. Persist provider
  run/task identities as soon as received; retry read-only reconciliation with
  backoff. A lost identity requires explicit reconciliation, not a silent restart.
- Store exact input fingerprints, capability/binding versions and source references
  so future feature layers can reject stale results and recover materialization
  without generating again. Do not treat provider workflow IDs as immutable prompt
  content unless the target Dify version guarantees that property.
- Jobs and credit reservations are created atomically. Managed AI holds must not
  expire under the existing fifteen-minute temporary-hold rule while an execution
  can still complete. A reconciliation deadline escalates unresolved work for an
  operator; it does not prove provider failure or authorize an automatic refund.
- Settlement is idempotent and atomic with saved results. Account suspension blocks
  new dispatch/access; trusted settlement can account for already-started work.
  Chargebacks that cancel holds must produce an explicit settlement exception.
- Provider spend and user credits are distinct. Store usage in `aiUsage` linked to
  job, owner, provider execution and optional node identity. Record token counts,
  duration and currency/decimal cost when reported. Missing cost is unknown, never
  zero. Mark simulated and estimated values separately from provider-reported ones.
  Do not add node totals and run totals together or convert currencies implicitly.
- Logs contain safe operation IDs and error categories, not prompts, provider
  bodies, secrets or raw URLs. Durable execution inputs/results are private data;
  owner access and explicit retention apply separately from diagnostic logs.
- File transfer is bounded and owned. Do not fetch arbitrary provider output URLs
  with credentials or follow redirects to untrusted destinations. Future private
  assets must preserve durable identity independently of expiring provider URLs.

## Verification required

Use local fixtures only: fragmented SSE/UTF-8, provider errors and limits; stable
identity and credential redaction; cross-user access; concurrent duplicate submit;
worker crash before/after acceptance; lease fencing; unknown outcome without
re-dispatch; paused/partial/failed/success outcomes; cancel-versus-finish races;
credit hold expiry, suspension and chargebacks; duplicate usage and exact costs;
file/conversation ownership; restart recovery and configuration rotation.

Run affected unit/account/HTTP integration tests, environment checks, TypeScript,
lint and production build. Exercise local fake flows in a browser if UI is added.
Quality checks remain advisory; compilation failures remain build failures.

## Provider references

Review corrections verified on 2026-10-06: chat requests preserve prepared input
variables, named file variables and top-level attachments without overriding
transport identity. AI submissions use a bounded 72 KiB JSON envelope so full-length
multibyte prompts fit; other endpoints retain their original limits. Five chat
tests, two AI HTTP tests, eight authentication HTTP tests, TypeScript, lint and
the production build passed. The follow-up read-only review found no remaining
actionable issues in these corrections. No live provider calls were used.

Reviewed against official documentation on 2026-10-05. Self-hosted Dify versions
may expose fewer endpoints; verify the deployed version before enabling live mode.

- [Workflow API](https://docs.dify.ai/en/api-reference/guides/workflow)
- [Streaming and recovery](https://docs.dify.ai/en/api-reference/guides/streaming)
- [Run details](https://docs.dify.ai/en/api-reference/workflow-runs/get-workflow-run-detail)
- [File ownership](https://docs.dify.ai/en/api-reference/files/upload-file)

### Configurable pricing extension

Fixed registry prices remain the default. `AI_PRICING_JSON` adds token, provider-cost and hybrid policies with immutable job terms, maximum reservations and partial settlement. See [pricing behavior and tests](ai-testing.md#configurable-credit-pricing), including the completed-summary requirement and missing-usage review policy.
