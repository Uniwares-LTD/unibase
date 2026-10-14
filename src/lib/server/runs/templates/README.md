# Orchestrator templates

Each JSON file contains public metadata, required MCP tool names and a complete
Dify DSL. `index.ts` loads them on the server and binds the selected authorized MCP
provider when importing. Never put credentials, deployment URLs or real user data
in templates.

- `document-summary.json`: reference document → Brief/Detailed → summary.
- `catalog-picker.json`: synthetic catalog → item choice → selected item details.
- `quote-approval.json`: synthetic quote → approve/decline → simulated outcome.

The three scenarios above use empty Start inputs, MCP structured JSON, native Human Input with
Generative UI, and Python Code/End output. Human answers arrive as a JSON object
keyed by card ID (for example `{"approval":"approve"}`). Approval saves no order
and makes no payment.

To add a template, add its JSON file and server import in `index.ts`, allowlist its
ID in `src/lib/contracts/orchestrator-templates.ts`, and add its MCP requirements.
Use supported node/output contracts and verify the embedded Code with actual tool
outputs and the Unibase answer format. Refresh Dify tool metadata before creation.

- `persona-responder.json`: bounded persona/question/context → structured LLM → normalized answer. Configure the Dify model/provider before use; no MCP binding is needed.
- `saved-artifact.json`: private Run context → owned draft read/save → revision-bound approval/decline → synthetic retained image. Start this from an owned artifact.
- `story-panel.json`: Story idea → AI story → Approved/Send changes review form → AI revision and character description → revision-bound approval → real generated panel. Start from an owned artifact. Configure the LLM nodes and authorize OpenAI Tools in Dify. Decline retains the draft without generating an image.

Private tools bind the server-filled `unibase_context` directly; never send that
value to a prompt. The artifact sample's approval metadata is rendered dynamically
and validated against the saved revision. Persona responders receive no private
capabilities and cannot call product tools.

Story generation receives the artifact tool's JSON directly. Story review uses one
version-1 form card (`review`) with a required `decision` choice (`approved` or
`changes`) and optional `changes` text (4,000 characters maximum). Save response,
then Continue. The revision LLM receives that response JSON directly, with
instructions to preserve approved stories (ignoring changes text) and to preserve
the original when requested changes are blank. Python still bounds form content,
extracts the exact draft revision, builds approval metadata and formats results.

The Story to panel End exposes native image-tool `files` as `unibase_images`
alongside a version-1 result. The server downloads only signed image files on the
configured Dify origin and retains validated bytes privately. Tool form settings
are plain values, while dynamic tool parameters use variable bindings. The
responder's Code node normalizes unambiguous single-text answers and value-free
null acknowledgements; every answer still passes the server's full validation.

`project.config.json.examples` controls sample visibility and creation. Application
mode exposes the reusable Persona responder template; example mode explicitly
exposes all six. Accepted work retains its handler/binding snapshots. The JSON
catalog is the current source; `dify/` YAML files are historical compatibility
fixtures. Adding an ID also requires translation of its administrative presentation
and verification of its tool permissions, owned target and provider prerequisites.
