# Dify 1.17.1 templates

These sanitized `.yaml` files use JSON syntax (valid YAML). They remain reference fixtures; Administration download/import tools were removed. Registration never changes repository files. Import into disposable
Workflow apps first, inspect dependencies and graph bindings, then publish in
Dify. Import does not publish or enable an orchestrator.

`orchestrators/generation.yaml` exercises structured results without a model
credential. Replace its generation Code node with your LLM/Agent flow and retain
the result envelope. `ui-decision.yaml` exercises a parent Human Input checkpoint;
WebApp delivery must be enabled. Its native paragraph field is `response` and the
form retains `{{#$output.response#}}`. Unibase renders its fenced `unibase-ui` data
and submits validated answers as JSON through that field.

`mcp-reference.yaml` requires a Dify MCP integration with server identifier
`unibase_test`, pointing to Unibase `/api/mcp` with its separate service token.
Reconnect the Tool node through Dify's picker after import. Map its structured
`json` output through a Template node if `text` is empty; do not infer an MCP
success from prose. See [MCP setup](../docs/mcp.md).

`workflows/child-question.yaml` is a child tool that returns question data. Publish
it as a workflow tool, bind it in the parent, and pass its question data into the
parent Human Input node. Child tools cannot themselves pause for Human Input.
Pin the child publication wherever the tool configuration supports a workflow
version; record that binding when validating the parent.

`examples/failure.yaml` distinguishes a business failure from a technical crash.
`checkpoint-recovery.yaml` accepts `unibase_recovery` with version `1`, stage
`draft`, saved checkpoint data and a diagnostic flag. Legacy recovery snapshots may declare version `1` and stage `draft`; new registration
does not configure custom recovery. Change the version when
checkpoint semantics change. Recovery is a new linked execution, not node replay.
`image-result.yaml` returns bounded base64 bytes with a UUID reference; Unibase
mints its own owned asset ID. URLs are never fetched from generated output.

Configure the shared Dify connection described in [Runs setup](../docs/runs.md).
In Administration, **Create orchestrator** creates and publishes the minimal
template from `src/lib/server/runs/templates`, then registers it. The dropdown
offers Document summary, Catalog picker and Quote approval. Catalog/quote tools
require the Dify MCP client's `demo:read` permission and tool refresh. Connect
Unibase MCP with `get_reference_document_v1` first. Start a Run without inputs,
choose Brief/Detailed in Generative UI, Continue and view the demo document result
and tracing. The Code node requires Dify's sandbox; no model configuration is needed.
Existing published
workflows register directly. Unibase reuses or creates the API key, checks the
publication/inputs/Human Input/MCP configuration and enables the Orchestrator.
Register validates the saved draft and publishes it automatically when needed;
it never changes its nodes or inputs. New starters disable the public Web App,
while Human Input WebApp delivery remains enabled for Unibase's API forms.
Ordinary End outputs need no JSON
wrapper; Unibase normalizes them server-side. Inline prompts need no Start input.
Configure WebApp delivery for Human Input and synchronize/authenticate referenced
MCP tools. Model/plugin/MCP dependencies remain managed by Dify.

Live acceptance against a configured disposable 1.17.1 instance is required to
confirm installation-specific model/plugin, MCP and child-workflow bindings.
