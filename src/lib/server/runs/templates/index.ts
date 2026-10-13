import { project } from "@/lib/project";
import "server-only";
import documentSummary from "./document-summary.json";
import catalogPicker from "./catalog-picker.json";
import quoteApproval from "./quote-approval.json";
import type { OrchestratorTemplateId } from "@/lib/contracts/orchestrator-templates";

import personaResponder from "./persona-responder.json";
import savedArtifact from "./saved-artifact.json";
import storyPanel from "./story-panel.json";
type NodeData = {
  type: string;
  title: string;
  provider_type?: string;
  provider_id?: string;
  provider_name?: string;
  tool_name?: string;
  tool_parameters?: Partial<Record<string, { type: string; value: unknown }>>;
  form_content?: string;
  [key: string]: unknown;
};
type Dsl = Omit<typeof documentSummary.dsl, "workflow"> & {
  workflow: Omit<typeof documentSummary.dsl.workflow, "graph"> & {
    graph: {
      nodes: { id: string; data: NodeData; [key: string]: unknown }[];
      edges: typeof documentSummary.dsl.workflow.graph.edges;
    };
  };
};
const templates: {
  id: string;
  title: string;
  description: string;
  requiredTools: string[];
  dsl: Dsl;
}[] = [
  documentSummary,
  catalogPicker,
  quoteApproval,
  personaResponder,
  savedArtifact,
  storyPanel,
];

export function orchestratorTemplates() {
  return templates
    .filter(
      (template) => project.examples || template.id === "persona-responder",
    )
    .map(({ id, title, description }) => ({
      id: id as OrchestratorTemplateId,
      title,
      description,
    }));
}

export function orchestratorTemplate(id: OrchestratorTemplateId) {
  const template = templates.find(
    (template) =>
      template.id === id &&
      (project.examples || template.id === "persona-responder"),
  );
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
