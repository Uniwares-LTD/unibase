import { z } from "zod";
export const cleanupOptionsSchema = z.strictObject({
  olderThanDays: z.number().int().min(1).max(3650),
  scope: z.enum(["jobs", "failed-files", "both", "abandoned-uploads"]),
  limit: z.number().int().min(1).max(100),
});
export const cleanupExecuteSchema = z.strictObject({
  reportId: z.uuid(),
  confirm: z.literal(true),
  reason: z.string().trim().max(500).default(""),
});
export const paymentReviewSchema = z.strictObject({
  key: z.uuid(),
  orderId: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z
    .string()
    .regex(/^cs_[A-Za-z0-9_]+$/)
    .max(255)
    .optional(),
  reason: z.string().trim().max(500).default(""),
});
export const cleanupReportSchema = z.object({
  id: z.uuid(),
  state: z.enum(["preview", "completed"]),
  createdAt: z.string(),
  expiresAt: z.string(),
  cutoff: z.string(),
  jobs: z.number(),
  files: z.number(),
  abandonedUploads: z.number(),
  storagePending: z.number(),
  storageFailed: z.number(),
  storageDeleted: z.number(),
  changed: z.number(),
  skipped: z.number(),
  ids: z.array(z.string()),
});
export type CleanupReportView = z.infer<typeof cleanupReportSchema>;
