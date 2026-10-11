import { z } from "zod";
import { generatedCardSchema, cardRegistry, parseCard } from "../runs/cards";
import { aiPricingSchema } from "../config/ai-pricing";

export const runIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const inputFieldSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(100),
  kind: z.enum(["text", "paragraph", "number", "select", "file"]),
  required: z.boolean(),
  options: z.array(z.string().max(100)).max(30).default([]),
});
export const orchestratorSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  order: z.number().int().min(0).max(1000),
  appId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  keyEnv: z.string().regex(/^DIFY_KEY_[A-Z0-9_]+$/),
  enabled: z.boolean(),
  inputs: z
    .array(inputFieldSchema)
    .max(20)
    .refine(
      (fields) =>
        new Set(fields.map((f) => f.name)).size === fields.length &&
        fields.every(
          (f) =>
            !f.name.startsWith("unibase_") &&
            !["constructor", "prototype", "__proto__"].includes(f.name),
        ),
      "Input names must be unique application fields.",
    ),
  pricing: aiPricingSchema.nullable(),
  failureCharging: z
    .enum(["success-only", "verified-usage"])
    .nullable()
    .optional(),
  recovery: z
    .strictObject({
      version: z.string().max(64),
      stages: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)).max(30),
      diagnostic: z.boolean(),
    })
    .nullable(),
});
export type OrchestratorDefinition = z.infer<typeof orchestratorSchema>;
export const orchestratorUpdateSchema = z.strictObject({
  definition: orchestratorSchema,
  revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(5).max(300),
});
export const runStartSchema = z.strictObject({
  key: z.string().uuid(),
  orchestratorId: orchestratorSchema.shape.id,
  configurationKey: z.string().regex(/^[a-f0-9]{64}$/),
  inputs: z.record(z.string(), z.json()),
});
export const runCommandSchema = z.strictObject({
  key: z.string().uuid(),
  action: z.enum(["cancel", "restart", "recover", "test-stage"]),
  attemptId: runIdSchema,
  inputs: z.record(z.string(), z.json()).optional(),
  stage: z.string().max(64).optional(),
  configurationKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const decisionSubmitSchema = z.strictObject({
  key: z.string().uuid(),
  action: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,19}$/),
  answers: z.record(z.string(), z.json()),
});
export const uiPayloadSchema = z
  .strictObject({
    version: z.literal(1),
    cards: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
          content: generatedCardSchema,
        }),
      )
      .max(20),
  })
  .refine(
    (v) => new Set(v.cards.map((c) => c.id)).size === v.cards.length,
    "Duplicate card IDs.",
  );
export const resultSchema = z.strictObject({
  version: z.literal(1),
  outcome: z.enum(["success", "failed", "partial"]),
  text: z.string().max(100000),
  cards: uiPayloadSchema.shape.cards,
  images: z
    .array(
      z.strictObject({
        id: z.string().uuid(),
        base64: z.string().max(12 * 1024 * 1024),
        name: z.string().max(100),
      }),
    )
    .max(10)
    .default([]),
  failure: z.string().max(500).nullable().default(null),
  checkpoint: z
    .strictObject({
      version: z.string().max(64),
      stage: z.string().max(64),
      data: z.record(z.string(), z.json()),
    })
    .nullable()
    .default(null),
});
export function parseResult(outputs: unknown) {
  const envelope = z
    .object({ result: z.union([z.string(), z.json()]) })
    .parse(outputs);
  const result = resultSchema.parse(
    typeof envelope.result === "string"
      ? JSON.parse(envelope.result)
      : envelope.result,
  );
  if (new Set(result.cards.map((c) => c.id)).size !== result.cards.length)
    throw new Error("Duplicate result card IDs");
  return result;
}
export function parseUiForm(content: string) {
  if (!content.includes("{{#$output.response#}}"))
    throw new Error("Missing native response placeholder.");
  const matches = [...content.matchAll(/```unibase-ui\s*\n([\s\S]*?)\n```/g)];
  if (matches.length !== 1) throw new Error("Expected one UI definition.");
  return uiPayloadSchema.parse(JSON.parse(matches[0][1]));
}
export function validateAnswers(
  ui: z.infer<typeof uiPayloadSchema>,
  answers: Record<string, unknown>,
) {
  if (Object.keys(answers).some((id) => !ui.cards.some((c) => c.id === id)))
    throw new Error("Unknown card.");
  const result: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
  for (const card of ui.cards) {
    const parsed = parseCard(card.content, true);
    const definition = cardRegistry.get(parsed.type, parsed.version);
    if (!definition.actions.length) continue;
    if (!(card.id in answers)) throw new Error("Complete all cards.");
    result[card.id] = definition.response(
      parsed.data,
      definition.actions[0],
      answers[card.id],
    );
  }
  return result;
}

// Supported Dify 1.17.1 initial-input form controls. This also rejects file lists,
// URLs and unknown controls before an orchestrator can become selectable.
export function difyInitialInputs(parameters: unknown) {
  const parsed = z
    .object({ user_input_form: z.array(z.record(z.string(), z.unknown())) })
    .parse(parameters);
  const kinds = {
    "text-input": "text",
    paragraph: "paragraph",
    number: "number",
    select: "select",
    file: "file",
  } as const;
  return parsed.user_input_form.flatMap((field) =>
    Object.entries(field).map(([kind, value]) => {
      const v = z
        .object({
          variable: z.string(),
          label: z.string(),
          required: z.boolean().default(false),
          options: z.array(z.string()).default([]),
        })
        .parse(value);
      if (!(kind in kinds)) throw new Error("Unsupported Dify input control");
      return {
        name: v.variable,
        label: v.label,
        required: v.required,
        options: v.options,
        kind: kinds[kind as keyof typeof kinds],
      };
    }),
  );
}
