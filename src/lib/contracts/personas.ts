import { z } from "zod";
import { aiPricingSchema } from "../config/ai-pricing";

export const answererSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("user") }),
  z.strictObject({
    type: z.literal("persona"),
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    configurationKey: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export const personaFieldsSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  instructions: z.string().trim().min(1).max(3000),
  enabled: z.boolean(),
  archived: z.boolean(),
  pricing: aiPricingSchema
    .refine(
      (p) =>
        p.mode !== "provider-cost" &&
        (p.mode !== "hybrid" || p.usage.mode === "tokens"),
      "Persona pricing requires fixed credits or token usage.",
    )
    .default({ mode: "fixed", credits: 1 }),
  maxCalls: z.number().int().min(1).max(100).default(10),
});
export const personaChangeSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fields: personaFieldsSchema,
  reason: z.string().trim().max(500).default(""),
});
export const defaultCompletionInstructions =
  "Respond to the question as the supplied persona, using the supplied public context. Answer directly in the format appropriate to the question. Do not add a transport wrapper. Do not invent file uploads or claim human approval.";
export const personaCompletionSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    model: z.string().trim().max(200).default(""),
    temperature: z.number().min(0).max(2).nullable().default(null),
    maxOutputTokens: z.number().int().min(1).max(32768).default(1024),
    tokenParameter: z
      .enum(["max_completion_tokens", "max_tokens"])
      .default("max_completion_tokens"),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .default(defaultCompletionInstructions),
  })
  .refine(
    (s) => !s.enabled || !!s.model,
    "Select a model before enabling completions.",
  );
export const personaCompletionChangeSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  settings: personaCompletionSchema,
  reason: z.string().trim().max(500).default(""),
});
export type PersonaCompletionSettings = z.infer<typeof personaCompletionSchema>;
export type PersonaFields = z.infer<typeof personaFieldsSchema>;
export type Answerer = z.infer<typeof answererSchema>;
