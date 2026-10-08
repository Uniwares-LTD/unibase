import { z } from "zod";
export const timelinePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(10000) }),
  z.object({ type: z.literal("card"), cardId: z.string().uuid() }),
  z.object({
    type: z.literal("artifact"),
    artifactId: z.string().uuid(),
    version: z.number().int().positive(),
  }),
  z.object({ type: z.literal("batch"), batchId: z.string().uuid() }),
  z.object({
    type: z.literal("execution"),
    jobId: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["succeeded", "failed", "cancelled"]),
  }),
]);
export const timelineEntrySchema = z.object({
  id: z.string(),
  at: z.iso.datetime(),
  role: z.enum(["user", "assistant", "system"]),
  kind: z.string(),
  parts: z.array(timelinePartSchema),
});
export const timelinePageSchema = z.object({
  entries: z.array(timelineEntrySchema),
  next: z.string().nullable(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
