import { z } from "zod";
import {
  creationCapabilities,
  profileReferenceSchema,
} from "./execution-profile";
const stepId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const source = z.strictObject({
  artifactId: z.string().uuid(),
  version: z.number().int().positive(),
});
const common = {
  id: stepId,
  title: z.string().trim().min(1).max(120),
  dependsOn: z.array(stepId).max(12),
};
export const workflowStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...common,
    kind: z.literal("task"),
    capability: z.enum(creationCapabilities),
    prompt: z.string().trim().min(1).max(3000),
    count: z.number().int().min(1).max(3),
    selection: z.enum(["automatic", "human"]),
    profile: profileReferenceSchema.nullable(),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("new") }),
      z.strictObject({ kind: z.literal("input") }),
      z.strictObject({ kind: z.literal("step"), stepId }),
    ]),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("checkpoint"),
    requireApproval: z.boolean(),
  }),
]);
export const workflowDefinitionSchema = z
  .strictObject({
    type: stepId,
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(120),
    steps: z.array(workflowStepSchema).min(1).max(12),
  })
  .superRefine((definition, ctx) => {
    const steps = new Map(definition.steps.map((step) => [step.id, step]));
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (steps.size !== definition.steps.length)
      problem("Step IDs must be unique.");
    for (const step of definition.steps) {
      if (
        new Set(step.dependsOn).size !== step.dependsOn.length ||
        step.dependsOn.some((id) => !steps.has(id) || id === step.id)
      )
        problem("Dependencies must name distinct other steps.");
      if (step.kind === "task") {
        if (step.selection === "automatic" && step.count !== 1)
          problem("Automatic selection requires exactly one candidate.");
        if (
          step.target.kind === "step" &&
          !step.dependsOn.includes(step.target.stepId)
        )
          problem("A target step must be a direct dependency.");
        if (
          step.capability === "workspace-review" &&
          step.target.kind === "new"
        )
          problem("Review steps require an artifact target.");
      }
    }
    const visit = (id: string, trail: Set<string>): boolean => {
      if (trail.has(id)) return true;
      const next = new Set(trail).add(id);
      return steps.get(id)?.dependsOn.some((dep) => visit(dep, next)) ?? false;
    };
    if (definition.steps.some((step) => visit(step.id, new Set())))
      problem("Workflow dependencies cannot contain cycles.");
  });
export const workflowStartSchema = z.strictObject({
  key: z.string().uuid(),
  expectedUid: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  definition: workflowDefinitionSchema,
  prompt: z.string().trim().min(1).max(6000),
  sources: z.array(source).max(20),
  targetId: z.string().uuid().nullable(),
  pricingKeys: z.partialRecord(
    z.enum(creationCapabilities),
    z.string().regex(/^[a-f0-9]{64}$/),
  ),
  maximumCredits: z.number().int().nonnegative(),
});
export const workflowActionSchema = z.strictObject({
  key: z.string().uuid(),
  expectedUid: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  action: z.enum(["pause", "resume", "cancel", "checkpoint"]),
  stepId: stepId.optional(),
});
export const workflowRunSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  revision: z.number().int(),
  title: z.string(),
  status: z.enum(["active", "paused", "cancelled", "completed"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  maximumCredits: z.number(),
  repairIssueIds: z.array(z.string().uuid()).default([]),
  steps: z.array(
    z.object({
      id: stepId,
      title: z.string(),
      kind: z.enum(["task", "checkpoint"]),
      status: z.enum([
        "waiting",
        "running",
        "awaiting-human",
        "blocked",
        "completed",
      ]),
      batchId: z.string().uuid().nullable(),
      artifacts: z.array(source),
      error: z.string().nullable(),
      checkpointBy: z.string().nullable(),
      checkpointAt: z.string().nullable(),
    }),
  ),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowRunView = z.infer<typeof workflowRunSchema>;
export type WorkflowStart = z.infer<typeof workflowStartSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
