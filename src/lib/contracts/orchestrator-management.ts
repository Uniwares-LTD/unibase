import { z } from "zod";
import { orchestratorTemplateIdSchema } from "./orchestrator-templates";
import { workflowVersionSelectionSchema } from "./workflow-versions";

export const managementCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("discover") }),
  z.strictObject({
    action: z.literal("create"),
    key: z.string().uuid(),
    templateId: orchestratorTemplateIdSchema.default("document-summary"),
  }),
  z.strictObject({
    action: z.literal("copy"),
    key: z.uuid(),
    appId: z.uuid(),
    selection: workflowVersionSelectionSchema,
  }),
  z.strictObject({
    action: z.literal("register"),
    appId: z.string().uuid(),
    selection: workflowVersionSelectionSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("versions"),
    appId: z.string().uuid(),
    page: workflowVersionSelectionSchema.shape.page.default(1),
  }),
  z.strictObject({ action: z.literal("status"), appId: z.string().uuid() }),
  z.strictObject({
    action: z.literal("disable"),
    orchestratorId: z.string().min(1).max(100),
  }),
  z.strictObject({
    action: z.literal("unregister"),
    orchestratorId: z.string().min(1).max(100),
  }),
]);
