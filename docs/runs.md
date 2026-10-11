# Orchestrator Runs

Users select an enabled Workflow orchestrator at `/runs/new`. Its initial fields
and maximum price are shown before admission. `/runs` lists owned executions;
detail shows stage evidence, pending/submitted decisions, private results and
ordered attempts. Closing the browser does not stop the worker. Cancellation is
pending until provider termination is confirmed. Unknown acceptance/reconciliation
is visible and never creates a second generation request automatically.

## Administration and setup

Use `/admin/settings` for branding/default appearance, credit packs/expiry, all
pricing modes, admission/reconciliation policy, media limits and cleanup defaults.
Saved settings seed from environment once. Later environment changes do not
replace saved policy. Public branding is allowlisted; user preferences override
defaults. New attempts/purchases use current policy, while accepted terms remain
frozen. Credentials, provider/storage connections and deployment identity remain
in environment configuration. Updates require fresh administrator authority,
recent authentication, mutation protection, matching revisions and an audit reason.
Previously initialized settings that lack upload limits read the original defaults:
20 MiB per file, 100 files and 100 MiB per account. Reading these defaults does not
rewrite saved settings or replace billing terms; explicitly saved limits still apply.

Configure `DIFY_MODE=live`, a HTTPS `DIFY_BASE_URL` ending `/v1`, and named
`DIFY_KEY_*` app execution credentials. In `/admin/orchestrators`, register app ID,
published workflow UUID, inputs, credential reference and optional pricing/failure-charging/recovery overrides.
Validate connectivity and input compatibility before enabling. Multiple enabled
orchestrators can be selectable. Missing keys prevent admission. Disabling a
registration prevents new attempts; accepted attempts retain their configuration.

Console discovery/import/export additionally uses `DIFY_CONSOLE_URL`, a separate
`DIFY_MANAGEMENT_KEY` and `DIFY_WORKSPACE_ID`. Enable admin API key authentication
on the self-hosted Dify instance. There is no browser-cookie authentication
fallback. Without management, register execution credentials and download the
repository templates from Administration for manual import. Imports default to
new apps; overwrite requires an explicit target and confirmation. Review pending
confirmation/dependency warnings in Dify. Importing does not publish or enable.
Exports request `include_secret=false`. Unknown import responses require inspecting
Dify before repeating; the application retains a durable operation intent.

## Versioned application contract

Initial inputs include server-generated `unibase_run_id` and
`unibase_attempt_id`. Recovery adds serialized `unibase_recovery`. These fields
cannot be supplied as user-defined inputs. End returns `result`, either an object
or serialized JSON, with `version:1`, `outcome:success|failed|partial`, `text`,
`cards`, `images`, optional safe `failure` and `checkpoint`. Technical failure and
business failure are separate; prose does not decide the result status.

Cards are versioned registered question, form, summary, gallery, progress and
issue data. Forms support choices, toggles, numbers and bounded text. Unknown or
malformed UI cannot submit. Gallery references must belong to the same Run.
Images carry validated base64 bytes and UUID references; the app remaps them to
private owned asset IDs. Arbitrary fetch URLs and executable HTML/React are absent
from the contract. The shared schemas in `src/lib/contracts/runs.ts` and
`src/lib/runs/cards.ts` are authoritative; sample DSL is under `dify/`.

The parent Human Input form has one fenced `unibase-ui` JSON payload, a paragraph
input named `response`, the native `{{#$output.response#}}` placeholder and Dify
continuation actions. The server submits `{action,inputs:{response},user}` with
serialized validated answers and the original opaque user. Native paragraph,
select and owned file forms use the same renderer. Form tokens remain server-side;
application decision IDs and current ownership control access. Submission intent
precedes the provider request. Unknown responses are reconciled from evidence
without blindly resubmitting. Expired/unavailable forms show clear status.

Workflow tools cannot pause for Human Input in 1.17.1. Child tools return question
data; their parent pauses and routes answers. Display child calls as parent stages.
Standalone Agent/Chatflow modes and arbitrary internal child tracing are outside
this contract. The parent published UUID is pinned for accepted attempts. Pin child
publications in tool configuration wherever supported and revalidate after edits.

## Credits and recovery

Default: reserve one credit, charge one on successful completion and release on
confirmed failure/cancellation. Admin policies support fixed, total/split tokens,
provider cost and hybrid prices, including free execution. Verified-usage failure
billing omits fixed base charges. Unconfirmed decision submissions also retain their hold for administrator review when snapshot evidence cannot confirm them. Missing usage requires review rather than an
estimated charge. Reopening/polling/decisions never reserve again.

Retry stage requires declared compatible checkpoint version/stage data; otherwise
restart with editable initial inputs and latest enabled configuration. Both create
new linked attempts and disclose current maximum pricing. Uncertain attempts
cannot restart without provider evidence or explicit audited administrator
resolution. Resolution does not stop a provider execution and can permit duplicate
work; Administration states this when resolving. Diagnostic testing is admin-only
and requires the orchestrator's declared diagnostic entry point. Unsupported
stages require a full run. Failed/partial results and previous attempts remain.

## Pinned API evidence

The integration targets [Dify 1.17.1 admin authentication](https://github.com/langgenius/dify/blob/1.17.1/api/extensions/ext_login.py),
[workflow event reconnect](https://github.com/langgenius/dify/blob/1.17.1/api/controllers/service_api/app/workflow_events.py),
[Human Input forms](https://github.com/langgenius/dify/blob/1.17.1/api/controllers/service_api/app/human_input_form.py),
[stream payloads](https://github.com/langgenius/dify/blob/1.17.1/api/core/app/entities/task_entities.py),
[DSL import](https://github.com/langgenius/dify/blob/1.17.1/api/controllers/console/app/app_import.py),
and [workflow tools](https://github.com/langgenius/dify/blob/1.17.1/api/core/tools/workflow_as_tool/tool.py).
Fixture verification does not substitute for live acceptance on the configured
installation. See [AI testing](ai-testing.md).
