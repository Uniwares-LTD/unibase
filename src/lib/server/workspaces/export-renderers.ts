import "server-only";
import { createHash } from "node:crypto";
import { zipSync, strToU8, type Zippable } from "fflate";
import { AppError } from "@/lib/auth-policy";
import { createRegistry } from "@/lib/creation/registry";
import type { ExportSnapshot } from "@/lib/contracts/export";

export type ExportRenderContext = {
  snapshot: ExportSnapshot;
  signal: AbortSignal;
  maxBytes: number;
  // The worker provides an owner-scoped reader. Renderers may request only assets
  // captured in the admission snapshot, never arbitrary URLs or filesystem paths.
  readAsset: (id: string) => Promise<Buffer>;
  progress: (percent: number) => Promise<void>;
};
export type ExportRenderer = {
  type: string;
  version: number;
  format: "pdf" | "zip";
  label: string;
  mime: string;
  render: (context: ExportRenderContext) => Promise<Buffer>;
};
export async function readExportAsset(
  context: ExportRenderContext,
  id: string,
) {
  context.signal.throwIfAborted();
  const expected = context.snapshot.assets.find((asset) => asset.id === id);
  if (!expected)
    throw new AppError(
      "EXPORT_ASSET_INVALID",
      "The renderer requested an asset outside the saved export.",
      409,
    );
  const bytes = await context.readAsset(id);
  context.signal.throwIfAborted();
  if (
    bytes.length !== expected.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== expected.digest
  )
    throw new AppError(
      "EXPORT_ASSET_INVALID",
      "An export image no longer matches its saved identity.",
      409,
    );
  return bytes;
}
export function boundedExport(bytes: Uint8Array, maxBytes: number) {
  if (bytes.length > maxBytes)
    throw new AppError(
      "EXPORT_TOO_LARGE",
      "The generated file exceeds the storage limit. Export fewer artifacts.",
      413,
    );
  return Buffer.from(bytes);
}
export const archiveRenderer: ExportRenderer = {
  type: "archive",
  version: 1,
  format: "zip",
  label: "Artifact archive",
  mime: "application/zip",
  async render(context) {
    const { snapshot, signal, progress } = context;
    signal.throwIfAborted();
    const files: Zippable = {
      "manifest.json": strToU8(JSON.stringify(snapshot, null, 2)),
    };
    for (const artifact of snapshot.artifacts) {
      const path = `artifacts/${artifact.artifactId}/v${artifact.version.number}`;
      files[`${path}.json`] = strToU8(JSON.stringify(artifact, null, 2));
      files[`${path}.txt`] = strToU8(
        `${artifact.version.title}\n\n${artifact.version.body}\n`,
      );
    }
    for (let index = 0; index < snapshot.assets.length; index++) {
      const asset = snapshot.assets[index];
      files[`assets/${asset.id}.png`] = [
        await readExportAsset(context, asset.id),
        { level: 0 },
      ];
      await progress(
        Math.round(10 + (65 * (index + 1)) / snapshot.assets.length),
      );
    }
    signal.throwIfAborted();
    await progress(80);
    // Stable timestamps avoid leaking worker-local clock/timezone into retries.
    const bytes = zipSync(files, { level: 6, mtime: new Date(2000, 0, 1) });
    signal.throwIfAborted();
    return boundedExport(bytes, context.maxBytes);
  },
};
// Product renderers are registered in trusted server code and keep old versions
// available for persisted jobs. A request cannot install a renderer.
export const exportRenderers = createRegistry<ExportRenderer>([
  archiveRenderer,
  {
    type: "document",
    version: 1,
    format: "pdf",
    label: "Readable document",
    mime: "application/pdf",
    render: async (context) =>
      (await import("./export-pdf")).renderPdf(context),
  },
]);
