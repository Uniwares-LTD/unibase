import "server-only";
import documentSummary from "./document-summary.json";
import catalogPicker from "./catalog-picker.json";
import quoteApproval from "./quote-approval.json";
import type { OrchestratorTemplateId } from "@/lib/contracts/orchestrator-templates";

const templates = [documentSummary, catalogPicker, quoteApproval];

export function orchestratorTemplates() {
  return templates.map(({ id, title, description }) => ({
    id: id as OrchestratorTemplateId,
    title,
    description,
  }));
}

export function orchestratorTemplate(id: OrchestratorTemplateId) {
  const template = templates.find((template) => template.id === id);
  if (!template) throw new Error("Unknown orchestrator template");
  return {
    ...template,
    // Bind only the selected, authorized provider. JSON files contain no secrets.
    build(providerId: string) {
      const dsl = structuredClone(template.dsl);
      for (const node of dsl.workflow.graph.nodes) {
        if (node.data.type === "tool" && node.data.provider_type === "mcp") {
          node.data.provider_id = providerId;
          node.data.provider_name = providerId;
        }
      }
      return dsl;
    },
  };
}
