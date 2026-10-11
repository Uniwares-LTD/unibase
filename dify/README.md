# Dify 1.17.1 templates

These sanitized `.yaml` files use JSON syntax (valid YAML). The application reads
them for downloads and never changes repository files. Import into disposable
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
`draft`, saved checkpoint data and a diagnostic flag. Register recovery as
`{"version":"1","stages":["draft"],"diagnostic":true}`. Change the version when
checkpoint semantics change. Recovery is a new linked execution, not node replay.
`image-result.yaml` returns bounded base64 bytes with a UUID reference; Unibase
mints its own owned asset ID. URLs are never fetched from generated output.

After publishing, register the app ID, published workflow UUID, initial `prompt`
input and an environment execution key reference in `/admin/orchestrators`.
Validate before making it selectable. Console management is optional and uses a
separate admin API key and workspace UUID. Without it, download these templates,
import manually in Dify and register the app using its execution credentials.

Live acceptance against a configured disposable 1.17.1 instance is required to
confirm installation-specific model/plugin, MCP and child-workflow bindings.
