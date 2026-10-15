# Orchestrator templates

Each JSON file contains public metadata, required MCP tool names and a complete
Dify DSL. `index.ts` loads them on the server and binds the selected authorized MCP
provider when importing. Never put credentials, deployment URLs or real user data
in templates.

- `document-summary.json`: reference document → Brief/Detailed → summary.

Document summary demonstrates empty Start inputs, MCP structured JSON, native Human
Input with Generative UI, and a prompted LLM/End output. Configure its model in Dify.
Responses may be raw text or UI JSON keyed by card ID.

To add a template, add its JSON file and server import in `index.ts`, allowlist its
ID in `src/lib/contracts/orchestrator-templates.ts`, and add its MCP requirements.
Use supported node/output contracts and verify the embedded Code with actual tool
outputs and the Unibase answer format. Refresh Dify tool metadata before creation.

- `saved-artifact.json`: private Run context → owned draft read/save → revision-bound approval/decline → synthetic retained image. Start this from an owned artifact.
- `story-panel.json` (Unitale): Story idea → AI story → Approved/Send changes review form → AI revision and character description → revision-bound approval → real generated panel. Start from an owned artifact. Configure the LLM nodes and authorize OpenAI Tools in Dify. Decline retains the draft without generating an image.

Private tools bind the server-filled `context` directly; never send that
value to a prompt. The artifact sample's approval metadata is rendered dynamically
and validated against the saved revision. Persona completions receive no private
capabilities and cannot call product tools.
Persona completions are configured in Persona administration and use a direct
OpenAI-compatible model API; they are not Orchestrator templates. Only public
question/context data is sent to them. Raw workflows need a paragraph `response`
input and a `continue` action for automatic answers. Private-MCP graphs still
snapshot the actual hidden input name; existing `unibase_context` graphs retain
their binding.
Unibase still checks rendering definitions, payload bounds, ownership and approval
permissions; MCP tools retain typed arguments.

Story generation receives the artifact tool's JSON directly. Story review uses one
version-1 form card (`review`) with a required `decision` choice (`approved` or
`changes`) and optional `changes` text (4,000 characters maximum). Save response,
then Continue. The revision LLM receives UI JSON or persona text directly, with
instructions to preserve approved stories (ignoring changes text) and to preserve
the original when requested changes are blank. Approval forms retain explicit
human Approve/Decline buttons. Personas submit raw text through `continue`; the
approval LLM outputs `approve` or `decline`, and only exact `approve` reaches the
approval tool. This never creates human-only approval evidence. Python constructs
forms, extracts the exact draft revision, builds approval metadata and formats results.

The Unitale End exposes native image-tool `files` as `unibase_images`
alongside a version-1 result. The server downloads only signed image files on the
configured Dify origin and retains validated bytes privately. Tool form settings
are plain values, while dynamic tool parameters use variable bindings.

`project.config.json.examples` controls sample visibility and creation. Application
mode exposes no example templates; example mode explicitly
exposes these three samples. Catalog picker and Quote approval were removed as
overlapping examples. Unitale retains the `story-panel` ID for creation-journal
compatibility; newly imported Dify apps are named Unitale. Accepted work retains its handler/binding snapshots. The JSON
catalog is the current source; `dify/` YAML files are historical compatibility
fixtures. Adding an ID also requires translation of its administrative presentation
and verification of its tool permissions, owned target and provider prerequisites.
