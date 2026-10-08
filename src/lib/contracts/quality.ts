import { z } from "zod";
import { profileReferenceSchema } from "./execution-profile";
export const qualityIssueSchema = z.object({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
  artifactId: z.string().uuid(),
  version: z.number().int().positive(),
  severity: z.enum(["suggestion", "blocking"]),
  message: z.string(),
  status: z.enum(["open", "accepted", "resolved"]),
  repairRunIds: z.array(z.string().uuid()).max(3),
  history: z.array(
    z.object({
      action: z.enum(["accept", "reopen", "resolve", "repair"]),
      uid: z.string(),
      at: z.string(),
      reason: z.string(),
      version: z.number().int().positive(),
      reviewId: z.string().uuid().nullable(),
      runId: z.string().uuid().nullable(),
    }),
  ),
});
export type QualityIssue = z.infer<typeof qualityIssueSchema>;
export const repairStartSchema = z.strictObject({
  key: z.string().uuid(),
  expectedUid: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  artifactId: z.string().uuid(),
  issueIds: z
    .array(z.string().uuid())
    .min(1)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length),
  instructions: z.string().trim().max(1500),
  composeProfile: profileReferenceSchema.nullable(),
  reviewProfile: profileReferenceSchema.nullable(),
  composePricingKey: z.string().regex(/^[a-f0-9]{64}$/),
  reviewPricingKey: z.string().regex(/^[a-f0-9]{64}$/),
  maximumCredits: z.number().int().nonnegative(),
});
export type RepairStart = z.infer<typeof repairStartSchema>;
