# Orchestrator templates

Each JSON file contains public metadata, required MCP tool names and a complete
Dify DSL. `index.ts` loads them on the server and binds the selected authorized MCP
provider when importing. Never put credentials, deployment URLs or real user data
in templates.

- `document-summary.json`: reference document → Brief/Detailed → summary.
- `catalog-picker.json`: synthetic catalog → item choice → selected item details.
- `quote-approval.json`: synthetic quote → approve/decline → simulated outcome.

All scenarios use empty Start inputs, MCP structured JSON, native Human Input with
Generative UI, and Python Code/End output. Human answers arrive as a JSON object
keyed by card ID (for example `{"approval":"approve"}`). Approval saves no order
and makes no payment.

To add a template, add its JSON file and server import in `index.ts`, allowlist its
ID in `src/lib/contracts/orchestrator-templates.ts`, and add its MCP requirements.
Use supported node/output contracts and verify the embedded Code with actual tool
outputs and the Unibase answer format. Refresh Dify tool metadata before creation.

- `persona-responder.json`: bounded persona/question/context ? structured LLM ? normalized answer. Configure the Dify model/provider before use; no MCP binding is needed.
- `saved-artifact.json`: private Run context ? owned draft read/save ? revision-bound approval/decline ? synthetic retained image. Start this from an owned artifact.

Private tools bind the server-filled `unibase_context` directly; never send that
value to a prompt. The artifact sample's approval metadata is rendered dynamically
and validated against the saved revision. Persona responders receive no private
capabilities and cannot call product tools.
