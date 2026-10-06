import { z } from "zod";
import { aiPricingSchema } from "@/lib/config/ai-pricing";

export const aiSubmitSchema = z.strictObject({
  key: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
  capability: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  inputs: z.record(z.string(), z.json()),
  conversationId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  expectedUid: z.string().min(1).max(128).optional(),
  pricingKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const aiJobIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const aiJobViewSchema = z.object({
  id: aiJobIdSchema,
  capability: z.string(),
  status: z.string(),
  credits: z.number().int().nonnegative(),
  pricing: aiPricingSchema,
  chargedCredits: z.number().int().nonnegative().nullable(),
  capped: z.boolean(),
  simulated: z.boolean(),
  conversationId: z.string().nullable(),
  cancelRequested: z.boolean(),
  inputs: z.record(z.string(), z.json()),
  outputs: z.record(z.string(), z.json()).nullable(),
  failure: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AiJobView = z.infer<typeof aiJobViewSchema>;
export const aiFileViewSchema = z.object({
  id: aiJobIdSchema,
  name: z.string(),
  type: z.string(),
  bytes: z.number(),
  status: z.string(),
  simulated: z.boolean(),
});

export const aiResolutionSchema = z
  .strictObject({
    decision: z.enum(["accept", "release"]),
    reason: z.string().trim().min(10).max(500),
    acknowledgeProviderMayStillRun: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.decision !== "release" ||
      value.acknowledgeProviderMayStillRun === true,
    {
      message:
        "Releasing credits does not stop an uncertain provider execution.",
    },
  );
