import { z } from "zod";

export const deploymentEnvironmentSchema = z.enum([
  "local",
  "staging",
  "production",
]);
export const workflowBindingSchema = z.strictObject({
  project: z.string().max(64),
  environment: deploymentEnvironmentSchema,
  workspaceId: z.uuid(),
  instance: z.url(),
  providerId: z.string().max(128),
  endpoint: z.url(),
});
export type WorkflowBinding = z.infer<typeof workflowBindingSchema>;
export const externalMcpMappingSchema = z.strictObject({
  source: z.string().min(1).max(128),
  destination: z.string().min(1).max(128),
});
export const workflowProvenanceSchema = z.strictObject({
  appId: z.uuid(),
  workflowId: z.uuid(),
});
