import { z } from "zod";
export const privateFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  bytes: z.number(),
  state: z.enum(["staging", "ready", "deleting", "deleted"]),
  createdAt: z.string(),
});
export const filePageSchema = z.object({
  rows: z.array(privateFileSchema),
  next: z.string().nullable(),
  usage: z.object({ count: z.number(), bytes: z.number() }),
});
export const uploadStartSchema = z.strictObject({
  key: z.string().uuid(),
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(100),
  bytes: z.number().int().positive().safe(),
});
export const uploadStatusSchema = z.object({
  file: privateFileSchema,
  partBytes: z.number(),
  count: z.number(),
  received: z.array(z.number()),
});
