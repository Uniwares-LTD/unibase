import { z } from "zod";
import { stylePreferenceSchema } from "../appearance";

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    theme: z.enum(["light", "dark", "system"]),
    style: stylePreferenceSchema.optional(),
  })
  .strict();

export const profileSchema = profileUpdateSchema.extend({
  style: stylePreferenceSchema.default("default"),
  uid: z.string().min(1),
  email: z.string().email(),
  updatedAt: z.string().datetime(),
});
export type Profile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const sessionInputSchema = z
  .object({ idToken: z.string().min(1).max(16000) })
  .strict();
export const sessionResultSchema = z.object({ verified: z.boolean() });
export const successSchema = z.object({ ok: z.literal(true) });
export const csrfSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
  }),
});
