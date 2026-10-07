import { z } from "zod";

export const workspaceId = z.string().uuid();
const text = z.string().trim().min(1).max(500);
const option = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: text,
});
export const questionSchema = z
  .strictObject({
    kind: z.enum(["text", "single", "multiple"]),
    title: text,
    explanation: z.string().max(2000),
    options: z.array(option).max(12),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.options.map((o) => o.id)).size !== value.options.length ||
      (value.kind === "text"
        ? value.options.length !== 0
        : value.options.length < 2)
    )
      ctx.addIssue({
        code: "custom",
        message: "Question options must match its kind and have unique IDs.",
      });
  });
export const draftSchema = z.strictObject({
  title: text,
  body: z.string().trim().min(1).max(30000),
});
export const reviewSchema = z.strictObject({
  summary: text,
  issues: z
    .array(
      z.strictObject({
        severity: z.enum(["suggestion", "blocking"]),
        message: text,
      }),
    )
    .max(30),
});
export const imageOutputSchema = z.strictObject({
  title: text,
  // Inline bytes only: providers cannot ask the application to fetch arbitrary URLs.
  png: z
    .string()
    .min(4)
    .max(1_400_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export const studioOutputSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("question"), question: questionSchema }),
  z.strictObject({ type: z.literal("draft"), draft: draftSchema }),
]);
export const studioInputSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(10000),
  context: z.string().max(40000),
});
export const workspaceCapabilityNames = [
  "workspace-compose",
  "workspace-review",
  "workspace-image",
] as const;
export const dependencySchema = z.strictObject({
  artifactId: workspaceId,
  version: z.number().int().positive(),
});
const savedVersionSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  assetId: workspaceId.nullable(),
  dependencies: z.array(dependencySchema),
  createdAt: z.string(),
  sourceJobId: z.string().nullable(),
  decisionFingerprint: z.string().nullable(),
});
const approvalSchema = z.object({
  version: z.number(),
  uid: z.string(),
  at: z.string(),
  reason: z.string(),
});
export const workspaceSchema = z.object({
  schemaVersion: z.literal(1),
  id: workspaceId,
  title: z.string(),
  revision: z.number(),
  paused: z.boolean(),
  updatedAt: z.string(),
  cards: z.array(
    z.object({
      id: workspaceId,
      question: questionSchema,
      status: z.enum(["active", "answered", "superseded"]),
      answer: z.union([z.string(), z.array(z.string())]).nullable(),
      createdAt: z.string(),
    }),
  ),
  artifacts: z.array(
    z.object({
      id: workspaceId,
      versions: z.array(savedVersionSchema),
      approval: approvalSchema.nullable(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: workspaceId,
      artifactId: workspaceId,
      version: z.number(),
      result: reviewSchema,
      jobId: z.string(),
      createdAt: z.string(),
    }),
  ),
  approvals: z.array(approvalSchema.extend({ artifactId: workspaceId })),
  batches: z.array(
    z.object({
      id: workspaceId,
      capability: z.enum(workspaceCapabilityNames),
      prompt: z.string(),
      dependencies: z.array(dependencySchema),
      targetId: workspaceId.nullable(),
      selected: z.number().int().nullable(),
      createdAt: z.string(),
      maximumCredits: z.number(),
      items: z.array(
        z.object({
          jobId: z.string(),
          status: z.string(),
          error: z.string().nullable(),
          output: z.unknown().nullable(),
        }),
      ),
    }),
  ),
  assets: z.array(
    z.object({
      id: workspaceId,
      name: z.string(),
      mime: z.string(),
      bytes: z.number(),
    }),
  ),
});
export type WorkspaceView = z.infer<typeof workspaceSchema>;
export type Question = z.infer<typeof questionSchema>;
const base = {
  key: workspaceId,
  revision: z.number().int().nonnegative(),
  expectedUid: z.string().min(1).max(128),
};
export const workspaceCreateSchema = z.strictObject({
  key: workspaceId,
  title: text,
  expectedUid: base.expectedUid,
});
export const workspaceCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.literal("answer"),
    cardId: workspaceId,
    value: z.union([
      z.string().trim().min(1).max(4000),
      z.array(z.string()).min(1).max(12),
    ]),
  }),
  z.strictObject({ ...base, action: z.literal("reopen"), cardId: workspaceId }),
  z.strictObject({
    ...base,
    action: z.literal("save"),
    artifactId: workspaceId.nullable(),
    ...draftSchema.shape,
    dependencies: z.array(dependencySchema).max(20),
  }),
  z.strictObject({
    ...base,
    action: z.literal("approve"),
    artifactId: workspaceId,
    version: z.number().int().positive(),
    reason: z.string().trim().max(2000),
  }),
  z.strictObject({ ...base, action: z.literal("pause"), paused: z.boolean() }),
  z.strictObject({
    ...base,
    action: z.literal("batch"),
    capability: z.enum(workspaceCapabilityNames),
    prompt: studioInputSchema.shape.prompt,
    count: z.number().int().min(1).max(3),
    targetId: workspaceId.nullable(),
    dependencies: z.array(dependencySchema).max(20),
    pricingKey: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.strictObject({ ...base, action: z.literal("admit"), batchId: workspaceId }),
  z.strictObject({
    ...base,
    action: z.literal("select"),
    batchId: workspaceId,
    index: z.number().int().min(0).max(2),
  }),
  z.strictObject({
    ...base,
    action: z.literal("upload"),
    name: text,
    base64: z
      .string()
      .max(1_400_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  z.strictObject({
    ...base,
    action: z.literal("export"),
    artifactId: workspaceId,
    version: z.number().int().positive(),
    format: z.enum(["json", "text"]),
  }),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;

export function validAnswer(question: Question, value: string | string[]) {
  if (question.kind === "text")
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= 4000
    );
  const values = Array.isArray(value) ? value : [value];
  return (
    (question.kind === "multiple"
      ? Array.isArray(value)
      : typeof value === "string") &&
    values.length > 0 &&
    new Set(values).size === values.length &&
    values.every((v) => question.options.some((o) => o.id === v))
  );
}

export function currentVersion(artifact: WorkspaceView["artifacts"][number]) {
  return artifact.versions[artifact.versions.length - 1];
}
export function dependenciesCurrent(
  workspace: Pick<WorkspaceView, "artifacts">,
  dependencies: z.infer<typeof dependencySchema>[],
) {
  return dependencies.every((dep) => {
    const artifact = workspace.artifacts.find((a) => a.id === dep.artifactId);
    return artifact && currentVersion(artifact).number === dep.version;
  });
}
