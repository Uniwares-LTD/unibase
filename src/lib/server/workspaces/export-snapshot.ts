import "server-only";
import type { ClientSession, Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import {
  artifactRegistry,
  legacyArtifactContent,
} from "@/lib/creation/artifacts";
import {
  exportSnapshotSchema,
  type ExportSnapshot,
} from "@/lib/contracts/export";
import type { Workspace } from "./store";
import type { StoredAsset } from "./asset-storage";

const invalid = (message: string) =>
  new AppError("EXPORT_INVALID", message, 409);

// Called inside export admission's owned workspace transaction. Capture content,
// approval evidence and byte identities once; rendering never reads current versions.
export async function captureExportSnapshot(
  db: Db,
  workspace: Workspace,
  sources: { artifactId: string; version: number }[],
  session: ClientSession,
  now: Date,
): Promise<ExportSnapshot> {
  const assetIds = new Set<string>();
  const artifacts = sources.map((source) => {
    const artifact = workspace.artifacts.find(
      (item) => item.id === source.artifactId,
    );
    const version = artifact?.versions.find(
      (item) => item.number === source.version,
    );
    if (!artifact || !version)
      throw invalid("Choose saved versions from this workspace.");
    const content = version.content ?? legacyArtifactContent(version);
    const projected = artifactRegistry
      .get(content.type, content.version)
      .project(content.data);
    for (const id of projected.assetIds) assetIds.add(id);
    if (version.assetId) assetIds.add(version.assetId);
    const approval =
      artifact.approval?.version === version.number ? artifact.approval : null;
    return {
      artifactId: artifact.id,
      version: structuredClone({ ...version, content }),
      approval: approval
        ? {
            version: approval.version,
            at: approval.at,
            reason: approval.reason,
          }
        : null,
    };
  });
  if (assetIds.size > 100)
    throw invalid("Choose fewer image assets for this export.");
  const assets: ExportSnapshot["assets"] = [];
  let inputBytes = 0;
  for (const id of assetIds) {
    if (!workspace.assets.some((asset) => asset.id === id))
      throw invalid(
        "A selected version references an unavailable private asset.",
      );
    const asset = await db
      .collection<StoredAsset>("workspaceAssets")
      .findOne(
        { _id: id, uid: workspace.uid, workspaceId: workspace.id },
        { session, projection: { base64: 0, object: 0 } },
      );
    if (!asset || asset.mime !== "image/png")
      throw invalid("A selected image is unavailable in this workspace.");
    inputBytes += asset.bytes;
    if (inputBytes > 64 * 1024 * 1024)
      throw invalid(
        "Export image inputs must total at most 64 MiB. Select fewer artifacts.",
      );
    assets.push({
      id,
      name: asset.name,
      mime: asset.mime,
      bytes: asset.bytes,
      digest: asset.digest,
    });
  }
  const snapshot = exportSnapshotSchema.parse({
    schemaVersion: 1,
    workspaceId: workspace.id,
    title: workspace.title,
    capturedAt: now.toISOString(),
    artifacts,
    assets,
  });
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024)
    throw invalid("The export snapshot is too large. Select fewer artifacts.");
  return snapshot;
}
