import { z } from "zod";
export const creationCapabilities = [
  "workspace-compose",
  "workspace-review",
  "workspace-image",
] as const;
export const profileReferenceSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
});
export const profileDefinitionSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  capability: z.enum(creationCapabilities),
  binding: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .nullable(),
  instructions: z.string().trim().max(6000),
  includeConversation: z.boolean(),
  includeDecisions: z.boolean(),
  requiresSource: z.boolean(),
  audience: z.enum(["everyone", "admins"]),
  enabled: z.boolean(),
});
export const executionProfileSchema = profileDefinitionSchema
  .extend({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
  })
  .strip();
export const profileSummarySchema = executionProfileSchema.pick({
  id: true,
  revision: true,
  name: true,
  description: true,
  capability: true,
  requiresSource: true,
});
export const profileSaveSchema = z.strictObject({
  key: z.string().uuid(),
  expectedUid: z.string().min(1).max(128),
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  definition: profileDefinitionSchema,
  reason: z.string().trim().min(5).max(300),
});
export type ExecutionProfile = z.infer<typeof executionProfileSchema>;
export type ProfileSummary = z.infer<typeof profileSummarySchema>;
export type ProfileReference = z.infer<typeof profileReferenceSchema>;
