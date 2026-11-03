import { z } from "zod";
import manifest from "../../project.config.json";

// Product-shaped content bounds chosen per project in project.config.json.
// Omitted values keep the template defaults. Lowering a value does not rewrite
// stored records; it only bounds new saves and new Run results.
export const projectLimitsSchema = z.strictObject({
  artifactTextChars: z.number().int().min(1000).max(100_000).optional(),
  runImages: z.number().int().min(1).max(50).optional(),
});
const configured = projectLimitsSchema.parse(
  (manifest as { limits?: unknown }).limits ?? {},
);
export const limits = {
  artifactTextChars: configured.artifactTextChars ?? 8000,
  runImages: configured.runImages ?? 10,
};
