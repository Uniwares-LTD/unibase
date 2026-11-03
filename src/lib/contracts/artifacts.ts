import { z } from "zod";
import { limits } from "../limits";
export const artifactCreateSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
});
export const artifactCommandSchema = z.strictObject({
  action: z.literal("delete"),
});
export const artifactDraftSchema = z.strictObject({
  operationKey: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
  expectedRevision: z.number().int().nonnegative(),
  text: z.string().min(1).max(limits.artifactTextChars),
});
