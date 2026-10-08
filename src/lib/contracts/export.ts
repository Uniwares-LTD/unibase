import { z } from "zod";
import { dependencySchema, savedVersionSchema, workspaceId } from "./workspace";
import { registeredTypeSchema } from "@/lib/creation/registry";

export const exportRendererSchema = z.strictObject({
  type: registeredTypeSchema,
  version: z.number().int().positive().max(10000),
});
export const exportStartSchema = z.strictObject({
  key: workspaceId,
  expectedUid: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
  format: z.enum(["pdf", "zip"]),
  renderer: exportRendererSchema,
  sources: z
    .array(dependencySchema)
    .min(1)
    .max(20)
    .refine(
      (sources) =>
        new Set(
          sources.map((source) => `${source.artifactId}:${source.version}`),
        ).size === sources.length,
      "Select each artifact version only once.",
    ),
});
export const exportCancelSchema = z.strictObject({
  expectedUid: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
});
export const exportSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId,
  title: z.string(),
  capturedAt: z.iso.datetime(),
  artifacts: z
    .array(
      z.object({
        artifactId: workspaceId,
        version: savedVersionSchema,
        approval: z
          .object({
            version: z.number().int().positive(),
            at: z.string(),
            reason: z.string(),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(20),
  assets: z
    .array(
      z.object({
        id: workspaceId,
        name: z.string(),
        mime: z.string(),
        bytes: z.number().int().nonnegative(),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(100),
});
export type ExportSnapshot = z.infer<typeof exportSnapshotSchema>;
export const exportJobSchema = z.object({
  id: workspaceId,
  workspaceId,
  revision: z.number().int().nonnegative(),
  format: z.enum(["pdf", "zip"]),
  renderer: exportRendererSchema,
  sources: z.array(dependencySchema),
  status: z.enum(["queued", "rendering", "succeeded", "failed", "cancelled"]),
  progress: z.number().int().min(0).max(100),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
  assetId: workspaceId.nullable(),
});
export const exportListSchema = z.object({
  jobs: z.array(exportJobSchema).max(20),
});
export type ExportJobView = z.infer<typeof exportJobSchema>;
export type ExportOption = {
  type: string;
  version: number;
  format: "pdf" | "zip";
  label: string;
};
