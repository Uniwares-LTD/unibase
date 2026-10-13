import type { AiPricing } from "./config/ai-pricing";
import { maximumCredits } from "./config/ai-pricing";

type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: { amount: string; currency: string; source: "provider" } | null;
};
export type AiCharge = {
  credits: number;
  // Rounded uncapped charge is a string so very large provider bills never lose precision.
  calculatedCredits: string;
  capped: boolean;
};
type Fraction = { n: bigint; d: bigint };
function decimal(value: string): Fraction {
  if (!/^\d{1,18}(?:\.\d{1,18})?$/.test(value))
    throw new Error("Invalid billing decimal");
  const [whole, fraction = ""] = value.split(".");
  return {
    n: BigInt(whole + fraction),
    d: BigInt(10) ** BigInt(fraction.length),
  };
}
function add(a: Fraction, b: Fraction): Fraction {
  return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
}
function tokenCount(value: number | null) {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

// Only the completed run/message summary is billable. Node observations are
// diagnostics: summing them could double-count or omit nodes lost on disconnect.
export function calculateAiCharge(
  pricing: AiPricing,
  usage: Usage | null,
): AiCharge | null {
  if (pricing.mode === "fixed")
    return {
      credits: pricing.credits,
      calculatedCredits: String(pricing.credits),
      capped: false,
    };
  const rule = pricing.mode === "hybrid" ? pricing.usage : pricing;
  const base = pricing.mode === "hybrid" ? pricing.baseCredits : 0;
  let amount: Fraction;
  if (rule.mode === "tokens") {
    const counted = (count: number | null, rate: string): Fraction | null => {
      const value = decimal(rate);
      if (value.n === BigInt(0)) return { n: BigInt(0), d: BigInt(1) };
      return tokenCount(count)
        ? { n: BigInt(count!) * value.n, d: BigInt(1_000_000) * value.d }
        : null;
    };
    if (rule.rate.basis === "total") {
      const value = counted(
        usage?.totalTokens ?? null,
        rule.rate.creditsPerMillion,
      );
      if (!value) return null;
      amount = value;
    } else {
      const input = counted(
        usage?.inputTokens ?? null,
        rule.rate.inputCreditsPerMillion,
      );
      const output = counted(
        usage?.outputTokens ?? null,
        rule.rate.outputCreditsPerMillion,
      );
      if (!input || !output) return null;
      amount = add(input, output);
    }
  } else {
    const rate = decimal(rule.creditsPerCurrencyUnit);
    if (rate.n === BigInt(0)) amount = { n: BigInt(0), d: BigInt(1) };
    else {
      if (
        !usage?.cost ||
        usage.cost.currency !== rule.currency ||
        usage.cost.source !== "provider"
      )
        return null;
      let cost: Fraction;
      try {
        cost = decimal(usage.cost.amount);
      } catch {
        return null;
      }
      amount = { n: cost.n * rate.n, d: cost.d * rate.d };
    }
  }
  amount = add(amount, { n: BigInt(base), d: BigInt(1) });
  const rounded = (amount.n + amount.d - BigInt(1)) / amount.d;
  const cap = BigInt(maximumCredits(pricing));
  return {
    credits: Number(rounded > cap ? cap : rounded),
    calculatedCredits: rounded.toString(),
    capped: rounded > cap,
  };
}

export function pricingDescription(pricing: AiPricing): string {
  if (pricing.mode === "fixed")
    return `${pricing.credits} ${pricing.credits === 1 ? "credit" : "credits"} per successful attempt`;
  const rule = pricing.mode === "hybrid" ? pricing.usage : pricing;
  const usage =
    rule.mode === "provider-cost"
      ? `${rule.creditsPerCurrencyUnit} credits per ${rule.currency} of reported cost`
      : rule.rate.basis === "total"
        ? `${rule.rate.creditsPerMillion} credits per million total tokens`
        : `${rule.rate.inputCreditsPerMillion} / ${rule.rate.outputCreditsPerMillion} credits per million input / output tokens`;
  return `${pricing.mode === "hybrid" ? `${pricing.baseCredits} base credits + ` : ""}${usage}. Rounded up once; maximum ${pricing.maxCredits} credits.`;
}
