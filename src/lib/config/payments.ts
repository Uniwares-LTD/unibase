import { z } from "zod";

export function parseStripeConfig(
  input: Record<string, string | undefined>,
  enabled: boolean,
) {
  if (!enabled) return null;
  const parsed = z
    .object({
      key: z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/),
      webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/),
    })
    .safeParse({
      key: input.STRIPE_SECRET_KEY,
      webhookSecret: input.STRIPE_WEBHOOK_SECRET,
    });
  if (!parsed.success)
    throw new Error(
      "Invalid payment configuration: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET.",
    );
  return parsed.data;
}

export function proportionalCredits(
  credits: number,
  refunded: number,
  paid: number,
) {
  if (
    ![credits, refunded, paid].every(Number.isSafeInteger) ||
    credits <= 0 ||
    paid <= 0 ||
    refunded < 0 ||
    refunded > paid
  )
    throw new Error("Invalid verified payment amounts.");
  return Number((BigInt(credits) * BigInt(refunded)) / BigInt(paid));
}
