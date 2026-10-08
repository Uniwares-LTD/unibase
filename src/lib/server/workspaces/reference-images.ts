import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { workspaceImageInputSchema } from "@/lib/contracts/workspace";
import {
  aiFiles,
  uploadOwnedAiFile,
  resolveOwnedAiFile,
  createDifyFiles,
} from "../ai/files";
import { fingerprint, type AiJob } from "../ai/jobs";
import type { DifyConfig } from "@/lib/config/dify";
import type { Json, ProviderOutcome } from "../ai/types";
import { privateAssetStore } from "./asset-storage";
import type { PrivateAssetStore } from "./assets";

type Upload = (
  file: File,
  user: string,
  signal: AbortSignal,
) => Promise<ProviderOutcome<{ id: string }>>;
export function referenceUploader(config: DifyConfig, job: AiJob): Upload {
  if (config.mode === "fake" && job.binding.mode === "fake")
    return async () => ({ kind: "ok", value: { id: randomUUID() } });
  if (config.mode !== "live")
    throw new AppError(
      "AI_DISABLED",
      "Reference uploads require the configured image provider.",
      503,
    );
  const binding = config.bindings.find(
    (item) => item.name === job.binding.name,
  );
  if (
    !binding ||
    fingerprint([
      config.baseUrl,
      binding.apiKey,
      binding.workflowId ?? null,
      binding.revision,
      binding.kind,
    ]) !== job.binding.fingerprint
  )
    throw new AppError(
      "AI_BINDING_CHANGED",
      "Restore the saved provider binding before preparing references.",
      503,
    );
  const files = createDifyFiles(config, binding);
  return (file, user, signal) => files.upload(file, user, signal);
}

// Reference IDs are application-owned. Only this server boundary turns them into
// provider-local file descriptors; neither URLs nor provider file IDs are accepted.
export async function prepareReferenceImages(
  db: Db,
  job: AiJob,
  inputs: Record<string, Json>,
  upload: Upload,
  store: PrivateAssetStore = privateAssetStore(db),
): Promise<Record<string, Json>> {
  const parsed = workspaceImageInputSchema.parse(inputs);
  const references = parsed.referenceAssetIds ?? [];
  const ids = [
    ...new Set([
      ...references,
      ...(parsed.editAssetId ? [parsed.editAssetId] : []),
    ]),
  ];
  if (!ids.length) return { prompt: parsed.prompt, context: parsed.context };
  if (job.source?.type !== "workspace")
    throw new AppError(
      "AI_REFERENCE_INVALID",
      "Image references require an owned workspace.",
      409,
    );
  const deadline = AbortSignal.timeout(60000);
  const descriptors = new Map<string, Json>();
  for (const id of ids) {
    deadline.throwIfAborted();
    const asset = await store.get(job.uid, id);
    deadline.throwIfAborted();
    if (
      !asset ||
      asset.workspaceId !== job.source.id ||
      asset.mime !== "image/png"
    )
      throw new AppError(
        "AI_REFERENCE_INVALID",
        "A selected private image is unavailable in this workspace.",
        409,
      );
    // Successful files can be reused across candidates and batches, but unknown
    // uploads are never treated as success or automatically re-sent.
    let file = await aiFiles(db).findOne({
      uid: job.uid,
      "binding.fingerprint": job.binding.fingerprint,
      sha256: asset.digest,
      status: "ready",
      type: "image",
      cleanedAt: { $exists: false },
    });
    if (!file) {
      file = await uploadOwnedAiFile(
        db,
        { uid: job.uid, authTime: job.authTime },
        `reference:${fingerprint([job.source.id, parsed.referenceUploadScope ?? job._id, asset._id, job.binding.fingerprint])}`,
        job.binding,
        new File(
          [Buffer.from(asset.base64, "base64")],
          `reference-${asset._id}.png`,
          { type: "image/png" },
        ),
        (bytes, user) => upload(bytes, user, deadline),
      );
    }
    if (file.status === "failed")
      throw new AppError(
        "AI_REFERENCE_REJECTED",
        "The provider rejected a reference upload. No generation was dispatched.",
        409,
      );
    if (file.status !== "ready")
      throw new AppError(
        "AI_REFERENCE_UNCERTAIN",
        "A reference upload is unresolved. An administrator must review it before a new attempt.",
        409,
      );
    deadline.throwIfAborted();
    descriptors.set(
      id,
      await resolveOwnedAiFile(db, job.uid, job.binding, file._id, ["image"]),
    );
  }
  return {
    prompt: parsed.prompt,
    context: parsed.context,
    image_operation: parsed.editAssetId ? "edit" : "generate",
    reference_images: references.map((id) => descriptors.get(id)!),
    edit_image: parsed.editAssetId
      ? [descriptors.get(parsed.editAssetId)!]
      : [],
  };
}
