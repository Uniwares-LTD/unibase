import { z } from "zod";

export const workflowVersionSelectionSchema = z.strictObject({
  workflowId: z.string().uuid(),
  page: z.number().int().min(1).max(99999),
});
export type WorkflowVersionSelection = z.infer<
  typeof workflowVersionSelectionSchema
>;

// Public metadata only. Graphs, variable values and account details stay server-side.
export const workflowVersionsSchema = z.object({
  versions: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(200),
        version: z.string().max(100),
        number: z.number().int().positive().nullable(),
        createdAt: z.number().int().nonnegative(),
      }),
    )
    .max(10),
  page: z.number().int().min(1).max(99999),
  hasMore: z.boolean(),
});
export type WorkflowVersions = z.infer<typeof workflowVersionsSchema>;
