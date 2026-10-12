import { z } from "zod";
export const aiJobIdSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const aiResolutionSchema = z
  .strictObject({
    decision: z.enum(["accept", "release"]),
    reason: z.string().trim().max(500).default(""),
    acknowledgeProviderMayStillRun: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.decision !== "release" ||
      value.acknowledgeProviderMayStillRun === true,
    {
      message:
        "Resolving an attempt permits restart but does not stop an uncertain provider execution.",
    },
  );
