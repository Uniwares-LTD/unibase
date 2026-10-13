import { z } from "zod";
export const notificationPreferencesSchema = z.strictObject({
  runs: z.boolean(),
  credits: z.boolean(),
  account: z.boolean(),
});
export const notificationTemplateSchema = z.enum([
  "run-decision",
  "run-final",
  "credit-purchase",
  "credit-reversal",
  "account-access",
]);
export const notificationParamsSchema = z.strictObject({
  runId: z.string().min(1).max(128).optional(),
  status: z
    .enum(["succeeded", "failed", "cancelled", "active", "suspended"])
    .optional(),
  amount: z.number().int().nonnegative().safe().optional(),
  role: z.enum(["member", "admin"]).optional(),
});
export const notificationPageSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      template: notificationTemplateSchema,
      params: notificationParamsSchema,
      read: z.boolean(),
      createdAt: z.string(),
      text: z.string(),
      href: z.string(),
    }),
  ),
  next: z.string().nullable(),
  unread: z.number(),
  preferences: notificationPreferencesSchema,
});
