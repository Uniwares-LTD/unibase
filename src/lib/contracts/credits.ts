import { z } from "zod";

export const creditAccountSchema = z.object({
  balance: z.number().int(),
  available: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  debt: z.number().int().nonnegative(),
  history: z.array(
    z.object({
      id: z.string(),
      sequence: z.number().int(),
      kind: z.string(),
      delta: z.number().int(),
      reservedDelta: z.number().int(),
      balanceAfter: z.number().int(),
      debtAfter: z.number().int(),
      timestamp: z.iso.datetime(),
      reason: z.string().optional(),
    }),
  ),
  nextBefore: z.number().int().positive().nullable(),
  upcoming: z.array(
    z.object({
      credits: z.number().int().positive(),
      expiresAt: z.iso.datetime(),
    }),
  ),
  holds: z.array(
    z.object({
      id: z.string(),
      credits: z.number().int().positive(),
      expiresAt: z.iso.datetime(),
      managedJobId: z.string().optional(),
    }),
  ),
});
export type CreditAccount = z.infer<typeof creditAccountSchema>;
export const adjustmentSchema = z
  .object({
    targetUid: z.string().min(1).max(128),
    key: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    direction: z.enum(["grant", "deduct"]),
    reason: z.string().trim().max(300).default(""),
    expiresAt: z.date().nullable().optional(),
  })
  .strict();
export type PublicPack = { id: string; label: string; credits: number };
export type PublicOrder = {
  id: string;
  credits: number;
  label: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  createdAt: string;
};
