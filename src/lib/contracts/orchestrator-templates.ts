import { z } from "zod";

export const orchestratorTemplateIdSchema = z.enum([
  "document-summary",
  "catalog-picker",
  "quote-approval",
  "persona-responder",
  "saved-artifact",
  "story-panel",
]);
export type OrchestratorTemplateId = z.infer<
  typeof orchestratorTemplateIdSchema
>;
export type OrchestratorTemplateSummary = {
  id: OrchestratorTemplateId;
  title: string;
  description: string;
};
