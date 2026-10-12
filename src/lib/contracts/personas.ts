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
  responderId: z.string().max(100).nullable(),
  enabled: z.boolean(),
  archived: z.boolean(),
  pricing: aiPricingSchema.default({ mode: "fixed", credits: 1 }),
  maxCalls: z.number().int().min(1).max(100).default(10),
});
export const personaChangeSchema = z.strictObject({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  fields: personaFieldsSchema,
  reason: z.string().trim().max(500).default(""),
});
export const personaAnswerSchema = z.strictObject({
  action: z.string().min(1).max(20),
  answers: z.record(z.string(), z.json()),
});
export type PersonaFields = z.infer<typeof personaFieldsSchema>;
export type Answerer = z.infer<typeof answererSchema>;
