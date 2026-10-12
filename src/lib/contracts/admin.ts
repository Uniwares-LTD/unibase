import { z } from "zod";

export const uidSchema = z.string().min(1).max(128);
export const adminChangeSchema = z
  .object({
    targetUid: uidSchema,
    role: z.enum(["member", "admin"]),
    status: z.enum(["active", "suspended"]),
    reason: z.string().trim().max(300).default(""),
  })
  .strict();
export const adminProfileSchema = z
  .object({
    targetUid: uidSchema,
    displayName: z.string().trim().min(1).max(80),
    reason: z.string().trim().max(300).default(""),
  })
  .strict();
