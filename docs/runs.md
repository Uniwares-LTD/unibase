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
frozen. Management/encryption secrets, provider/storage connections and deployment
identity remain in environment configuration. Managed app execution keys are
encrypted in MongoDB. Updates require fresh administrator authority,
recent authentication, mutation protection, matching revisions and an audit reason.
Previously initialized settings that lack upload limits read the original defaults:
20 MiB per file, 100 files and 100 MiB per account. Reading these defaults does not
rewrite saved settings or replace billing terms; explicitly saved limits still apply.

Configure `DIFY_MODE=live`, `DIFY_BASE_URL` ending `/v1`, `DIFY_CONSOLE_URL`
ending `/console/api`, `DIFY_MANAGEMENT_KEY` and `DIFY_WORKSPACE_ID`. Both URLs
must use the same instance. Enable self-hosted Dify admin-key authentication with
permissions to read apps/publications/tool configuration and create app keys.
Allow reading node execution traces for complete tracing after continuation.
Register requires draft-read and publication permissions. Create additionally
requires app-import and Web App setting permissions.

At `/admin/orchestrators`, **Create orchestrator** opens a template dropdown,
then imports, publishes and registers the selected workflow without a form.
The server loads allowlisted JSON DSL files from `src/lib/server/runs/templates`;
only template names/descriptions reach the browser. Available scenarios:

| Template | Scenario | Required MCP tool |
| --- | --- | --- |
| Document summary | Fetch a guide and choose Brief/Detailed | `get_reference_document_v1` |
| Catalog picker | Fetch structured catalog data and choose an item | `get_demo_catalog_v1` |
| Quote approval | Calculate a synthetic quote, then approve or decline | `calculate_demo_quote_v1` |

Grant `demo:read` to the intended MCP client for catalog/quote scenarios, restart
the web process, then refresh that provider's tools in Dify. Quotes create no order
or payment. Each template binds an authorized provider with all required tools,
preferring `unibase_starter`. Missing tools stop creation before import.
The Document summary binds `get_reference_document_v1` (preferring
`unibase_starter` when available). Start sends empty inputs; MCP fetches the synthetic
`unibase-demo` document; Generative UI asks Brief/Detailed; a Code node consumes
the structured MCP JSON and returns ordinary End text. Dify's code sandbox must
work; no LLM credentials are required. Start a Run, choose an option, Continue,
then view its result and tracing. Existing published workflows use **Register**.
Create immediately shows the confirmed app and refreshes discovery automatically.
New starters disable the public Dify Web App (`enable_site=false`). API access and
the Human Input node's WebApp delivery stay enabled; they are separate settings.

**Disable** stops new Runs. **Enable** performs registration checks again before
allowing new Runs. **Unregister** removes the Unibase registration from Run choices;
the workflow remains in Dify and can be registered again. Accepted Runs continue
using their saved configuration and credential; results, tracing and history remain.

Admin refresh and the Start page reconcile registered apps against a complete Dify
catalog. Missing apps remain visible in Admin as **Unavailable in Dify**, with
**Delete registration** to remove the stale entry. Deletion never recreates the
Dify workflow. Fresh admission also verifies the app, so a stale browser cannot
start a deleted workflow or reserve credits. Disable/unregister are fenced against
concurrent registration and admission. Both require recent administrator login.

Provider errors or incomplete catalogs do not mark workflows deleted. Saved entries
remain manageable when Dify is unavailable. Unregister retains a private tombstone
and encrypted credentials needed by accepted Runs; it does not delete history,
assets, Dify apps or Dify keys. A workflow deleted after admission may fail through
the normal provider reconciliation and credit-settlement rules.

Creation records an idempotency key before import and remembers the returned app
ID. Retrying a confirmed creation resumes publication/registration. An unknown
import outcome is never repeated automatically: check Dify and register the new
app if present. Changed drafts are not published automatically. Creation only
publishes its own new app; registration never changes existing graphs.
Explicit authentication/permission rejection permits retry after correction.
Create checks a saved app before retrying settings or registration. If it was
deleted in Dify, Unibase clears the browser's creation retry key and asks the admin
to click Create again for a new workflow. Temporary failures retain the key;
deleted apps are not silently recreated by a retry.

Registration reads the saved draft, verifies supported inputs and declared Human
Input/MCP configuration, and publishes it when no publication exists or the draft
has changed. It rechecks the draft before publishing and verifies the resulting
publication. It then reuses or creates an encrypted execution key, checks API
access and saves an enabled Orchestrator. It never writes drafts, inserts nodes,
adds inputs or imports DSL. Repeating registration preserves an
unchanged definition. Incomplete registration is never enabled. Keys and active
registration are serialized to avoid duplicate creation; no graph-mutation journal
or Python sandbox adapter is required.

A fit Workflow has a published Start/End graph and Service API access. Its Start
controls must be text, paragraph, number, select or a single file; user text is
bounded by Dify up to 4,000 characters. Controls are optional when Dify declares
them optional; inline prompts need no input field and send `inputs: {}`.

Human Input nodes must enable WebApp delivery and use supported native fields and
actions. For Generative UI, Dify renders the `unibase-ui` card payload and native
`response` paragraph placeholder; literal definitions are validated on registration,
dynamic definitions are validated after rendering. Referenced MCP providers must
be authorized in the workspace and have the selected tools synchronized. Checks
read stored metadata, never execute tools, ask a human to act or run an LLM as a
probe. Actual network/model/plugin readiness still needs a test Run. Workflows do
not need to use every capability on every execution.

Dify owns general graph editing and MCP provider credentials. Workflows are
authored in Dify; Register publishes their current valid saved draft. Create
authors and publishes only its starter. A connected MCP server
may expose permission-checked read or write tools; registration does not create
new tool implementations. Unibase's included MCP tools remain read-only public
reference examples; application save operations need explicit bounded tools and
ownership rules. See [MCP setup and boundaries](mcp.md).

User pages start Runs, list owned history and show status, tracing, decisions and
results. Native `workflow_run_id`/`task_id` values track execution. Human Input
submits its form token and reconnects the same provider Run. Tracing is the saved
node-event timeline; Dify log lists are Run summaries, not full node tracing.
Raw provider prompts, credentials and other users' Runs are never shown.

Manual JSON definitions, DSL routes and graph setup services have been removed.
Legacy definitions/accepted attempts remain readable; old provider-side adapters
are not removed automatically. Registration uses the current publication as-is.
Base settings and billing/history policies remain unchanged.

Managed keys use AES-256-GCM and are bound to the Dify instance, workspace and app.
Web and AI workers read them directly from MongoDB; new registrations need no
app-key environment edit or process restart. Keep the same encryption secret on
both processes. Optionally set `DIFY_CREDENTIAL_ENCRYPTION_KEY` to a stable 32-byte
secret encoded as 64 hexadecimal characters; otherwise a separate encryption key
is derived from `DIFY_MANAGEMENT_KEY` using HKDF-SHA256. Keep the encryption secret
outside MongoDB and back it up separately. Changing it requires reconnecting apps
or restoring the previous value; a dedicated secret allows management-key rotation
without re-encrypting credentials. Earlier credential records remain available to
accepted attempts. No app key is exposed in browser responses, audit events or
Run snapshots, and read/execution paths never create keys.

Key acquisition is serialized per app with a durable creation intent. After an
uncertain creation response, reconnect first checks the key list; it reuses a
returned key and does not issue another create if no usable key can be confirmed.
Resolve that case in Dify, then retry registration. Explicit provider rejection
(permissions/key limit) permits another attempt after correction. Removing a local registration does not delete or revoke Dify keys.

Registration uses recent administrator authentication, CSRF protection and fresh
role checks around credential acquisition and enabling. `orchestratorRegistrations`
retains sanitized progress and audit intent; provider graphs/secrets and MCP
credentials stay in Dify. A final publication read detects a version change before
enabling. Old mutation-intent records are retained as historical evidence but no
active path resumes graph modifications.

## Versioned application contract

Local Run and attempt IDs identify owned history, retries and credit records.
The worker maps each attempt to Dify's `workflow_run_id` and `task_id` from
execution events. Dify returns these identities; it does not require matching
Start inputs. Run detail and reconnect use the provider Run ID, while stop uses
the task ID. Node events provide the persisted application progress timeline.
Dify's workflow logs are run summaries, not node-level tracing.
See [Workflow API](https://docs.dify.ai/en/api-reference/guides/workflow).

Registration never adds `unibase_run_id`, `unibase_attempt_id` or
`unibase_recovery`. Deprecated fields already declared by an existing workflow
remain server-filled for compatibility, with `legacyInputs` recording exactly
which fields to send. Older accepted snapshots retain their existing dispatch
shape. Recovery data belongs to the legacy checkpoint/restart feature; it is not
needed to resume Human Input. New registration does not enable custom recovery.
User controls come solely from Dify; there is no mandatory prompt field.

Unibase normalizes ordinary End outputs on its server. A single string is response
text, several outputs retain their values as JSON text, and an empty output is
an empty response. No special End name or provider-side adapter is required.
Explicit application envelopes retain `version:1`, `outcome:success|failed|partial`,
`text`, `cards`, `images` and safe optional failure/checkpoint data. Claimed rich
envelopes must validate; invalid rich data is never accepted as ordinary text.
Provider execution failures follow the durable worker policy.

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
