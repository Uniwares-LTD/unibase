import assert from "node:assert/strict";
import { test } from "node:test";
import {
  orchestratorTemplates,
  orchestratorTemplate,
} from "../../src/lib/server/runs/templates";
import { orchestratorTemplateIdSchema } from "../../src/lib/contracts/orchestrator-templates";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import { parseUiForm } from "../../src/lib/contracts/runs";
import { tools } from "../../src/lib/server/mcp/tools";

test("Template catalog exposes metadata only; templates bind isolated graphs and supported tools/forms", () => {
  const summaries = orchestratorTemplates();
  assert.equal(new Set(summaries.map((t) => t.id)).size, 6);
  for (const summary of summaries) {
    assert.deepEqual(Object.keys(summary).sort(), [
      "description",
      "id",
      "title",
    ]);
    const template = orchestratorTemplate(
      orchestratorTemplateIdSchema.parse(summary.id),
    );
    const dsl = template.build("authorized-provider");
    const fit = inspectDifyWorkflow(dsl.workflow.graph);
    assert.deepEqual(
      fit.inputs.map((f) => f.name),
      summary.id === "persona-responder"
        ? ["persona", "question", "context"]
        : summary.id === "story-panel"
          ? ["prompt"]
          : [],
    );
    assert.deepEqual(
      fit.mcpTools.map((tool) => tool.toolName),
      template.requiredTools,
    );
    for (const node of dsl.workflow.graph.nodes) {
      if (
        node.data.type === "human-input" &&
        node.data.form_content!.includes("```unibase-ui")
      )
        parseUiForm(node.data.form_content!);
      if (node.data.type === "tool" && node.data.provider_type === "mcp") {
        assert.equal(node.data.provider_id, "authorized-provider");
        const tool = tools.find((tool) => tool.name === node.data.tool_name);
        assert(tool);
        const parameters = Object.fromEntries(
          Object.entries(node.data.tool_parameters!).map(([name, input]) => [
            name,
            input!.value,
          ]),
        );
        if (!["saved-artifact", "story-panel"].includes(summary.id))
          tool.input.parse(parameters);
      }
    }
    dsl.app.name = "mutated";
    assert.notEqual(template.build("different-provider").app.name, "mutated");
  }
  for (const invalid of ["../secret", "unknown", "catalog-picker.json"])
    assert.equal(
      orchestratorTemplateIdSchema.safeParse(invalid).success,
      false,
    );
});
