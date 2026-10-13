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
