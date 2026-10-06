import { z } from "zod";

const credits = z.number().int().nonnegative().max(1_000_000_000);
const rate = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,9})?$/);
const tokenRate = z.discriminatedUnion("basis", [
  z.strictObject({ basis: z.literal("total"), creditsPerMillion: rate }),
  z.strictObject({
    basis: z.literal("split"),
    inputCreditsPerMillion: rate,
    outputCreditsPerMillion: rate,
  }),
]);
const usageRate = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("tokens"), rate: tokenRate }),
  z.strictObject({
    mode: z.literal("provider-cost"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    creditsPerCurrencyUnit: rate,
  }),
]);
export const aiPricingSchema = z
  .discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("fixed"), credits }),
    z.strictObject({
      mode: z.literal("tokens"),
      maxCredits: credits.positive(),
      rate: tokenRate,
    }),
    z.strictObject({
      mode: z.literal("provider-cost"),
      maxCredits: credits.positive(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      creditsPerCurrencyUnit: rate,
    }),
    z.strictObject({
      mode: z.literal("hybrid"),
      maxCredits: credits.positive(),
      baseCredits: credits,
      usage: usageRate,
    }),
  ])
  .refine(
    (value) => value.mode !== "hybrid" || value.baseCredits <= value.maxCredits,
  );
export type AiPricing = z.infer<typeof aiPricingSchema>;
export function maximumCredits(pricing: AiPricing) {
  return pricing.mode === "fixed" ? pricing.credits : pricing.maxCredits;
}

// Rates are application billing terms, not private Dify credentials. Only this
// allowlisted structure can reach the browser or a durable pricing snapshot.
export function parseAiPricing(
  env: Record<string, string | undefined>,
): Record<string, AiPricing> {
  if (!env.AI_PRICING_JSON) return {};
  try {
    if (env.AI_PRICING_JSON.length > 64 * 1024) throw new Error();
    const parsed = z
      .record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), aiPricingSchema)
      .parse(JSON.parse(env.AI_PRICING_JSON));
    if (Object.keys(parsed).length > 100) throw new Error();
    return parsed;
  } catch {
    throw new Error("Invalid AI_PRICING_JSON. Check capability pricing terms.");
  }
}
