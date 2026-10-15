import { z } from "zod";

export const orchestratorTemplateIdSchema = z.enum([
  "document-summary",
  "saved-artifact",
  "story-panel",
  "case-preparation",
]);
export type OrchestratorTemplateId = z.infer<
  typeof orchestratorTemplateIdSchema
>;
export type OrchestratorTemplateSummary = {
  id: OrchestratorTemplateId;
  title: string;
  description: string;
};
