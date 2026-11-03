# Dify workflow fixtures and current templates

The current Administration **Create orchestrator** catalog is the allowlisted JSON
catalog in [the template directory](../src/lib/server/runs/templates/README.md).
It contains Document summary, Case preparation, Saved artifact and the Unitale
story-panel sample. Application-mode projects hide these sample templates. Live
execution still requires
explicitly configured owned provider connections. See [Runs setup](../docs/runs.md#administration-and-setup).

The YAML files under this directory are retained historical compatibility fixtures,
not the current catalog or files served by Administration. Their JSON syntax is
valid YAML. They must not be mistaken for new-project activation instructions:

| Retained fixture | Purpose |
| --- | --- |
| `orchestrators/generation.yaml` | Older structured result envelope |
| `orchestrators/ui-decision.yaml` | Parent Human Input compatibility |
| `orchestrators/mcp-reference.yaml` | Synthetic MCP reference data |
| `workflows/child-question.yaml` | Child tool returning question data |
| `examples/failure.yaml` | Business failure versus provider crash |
| `examples/checkpoint-recovery.yaml` | Legacy accepted recovery snapshots |
| `examples/image-result.yaml` | Bounded retained image compatibility |

Keep credentials, private URLs and real user data out of all templates. Register
validates owned saved workflow configuration and does not rewrite repository files.
Creating/importing/publishing a live workflow remains an explicitly authorized
provider operation. Local fixture acceptance is documented in
[AI testing](../docs/ai-testing.md); it does not establish live installation support.
