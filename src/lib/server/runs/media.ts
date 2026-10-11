import type { Document } from "mongodb";
import "server-only";
import { createHash } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { parseAssetConfig } from "@/lib/config/assets";
import { parseResult } from "@/lib/contracts/runs";
import { cardRegistry } from "@/lib/runs/cards";
import { validatedImage } from "./image";
import { s3ObjectStore, type ObjectReference } from "./object-store";
import { fingerprint, type AiJob } from "../ai/jobs";
import type { ProviderExecution } from "../ai/types";

export type RunAsset = {
  _id: string;
  uid: string;
  logicalId: string;
  jobId: string;
  name: string;
  mime: string;
  bytes: number;
  digest: string;
  base64?: string;
  object?: ObjectReference;
  status: "staged" | "ready";
  createdAt: Date;
};
function uuid(hash: string) {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function prepareResult(
  db: Db,
  job: AiJob,
  execution: ProviderExecution,
) {
  if (!job.run) return;
  const result = parseResult(execution.outputs);
  const config = parseAssetConfig(process.env);
  const ids = new Map<string, string>();
  for (const image of result.images) {
    if (ids.has(image.id))
      throw new AppError("INVALID_RESULT", "Duplicate generated image.");
    const id = uuid(fingerprint([job._id, image.id]));
    ids.set(image.id, id);
    const normalized = await validatedImage(
      image.base64,
      job.run.imageBytes,
      job.run.imagePixels,
    );
    const digest = createHash("sha256").update(normalized.bytes).digest("hex");
    const collection = db.collection<RunAsset>("runAssets");
    const prior = await collection.findOne({ _id: id });
    if (prior) {
      if (prior.digest !== digest || prior.uid !== job.uid)
        throw new AppError("INVALID_RESULT", "Result image changed.");
      continue;
    }
    const asset: RunAsset = {
      _id: id,
      uid: job.uid,
      logicalId: job.run.logicalId,
      jobId: job._id,
      name: image.name,
      mime: normalized.mime,
      bytes: normalized.bytes.length,
      digest,
      status: "staged",
      createdAt: new Date(),
    };
    if (config.mode === "mongo")
      asset.base64 = normalized.bytes.toString("base64");
    else {
      const store = s3ObjectStore(config);
      const key = store.key(id);
      // Record intent before external writes. Conditional put/head make retries safe.
      await db
        .collection<Document & { _id: string }>("runAssetStages")
        .updateOne(
          { _id: id },
          {
            $setOnInsert: {
              uid: job.uid,
              jobId: job._id,
              key,
              digest,
              bytes: asset.bytes,
              storeId: store.id,
              state: "uploading",
              createdAt: new Date(),
            },
          },
          { upsert: true },
        );
      const existing = await store.head({ storeId: store.id, key });
      if (
        existing &&
        (existing.digest !== digest || existing.bytes !== asset.bytes)
      )
        throw new AppError("INVALID_RESULT", "Stored result changed.");
      asset.object = existing
        ? {
            storeId: store.id,
            key,
            ...(existing.versionId ? { versionId: existing.versionId } : {}),
          }
        : await store.put(key, normalized.bytes, normalized.mime, digest);
    }
    await collection.updateOne(
      { _id: id },
      { $setOnInsert: asset },
      { upsert: true },
    );
  }
  const cards = result.cards.map((card) => {
    const content = structuredClone(card.content);
    if (content.type === "gallery") {
      const data = content.data as {
        items: { assetId: string; label: string }[];
      };
      for (const item of data.items)
        item.assetId = ids.get(item.assetId) ?? item.assetId;
    }
    return { ...card, content };
  });
  for (const card of cards)
    for (const id of cardRegistry
      .get(card.content.type, card.content.version)
      .assets(card.content.data)) {
      if (
        !(await db
          .collection<RunAsset>("runAssets")
          .findOne({ _id: id, uid: job.uid, logicalId: job.run.logicalId }))
      )
        throw new AppError(
          "INVALID_RESULT",
          "An image is unavailable for this run.",
        );
    }
  const safe = {
    ...result,
    images: result.images.map((image) => ({
      id: ids.get(image.id)!,
      name: image.name,
    })),
    cards,
  };
  await db
    .collection<{ _id: string; uid: string; result: typeof safe }>("runResults")
    .updateOne(
      { _id: job._id },
      { $setOnInsert: { uid: job.uid, result: safe } },
      { upsert: true },
    );
}
export async function attachResult(db: Db, job: AiJob, session: ClientSession) {
  await db
    .collection<RunAsset>("runAssets")
    .updateMany(
      { jobId: job._id, uid: job.uid },
      { $set: { status: "ready" } },
      { session },
    );
  await db
    .collection("runAssetStages")
    .updateMany(
      { jobId: job._id },
      { $set: { state: "published" } },
      { session },
    );
}
export async function readRunAsset(db: Db, uid: string, id: string) {
  const asset = await db
    .collection<RunAsset>("runAssets")
    .findOne({ _id: id, uid, status: "ready" });
  if (!asset) throw new AppError("ASSET_NOT_FOUND", "Image unavailable.", 404);
  let bytes: Buffer;
  if (asset.base64) bytes = Buffer.from(asset.base64, "base64");
  else {
    const config = parseAssetConfig(process.env);
    if (config.mode !== "s3" || !asset.object)
      throw new AppError(
        "ASSET_UNAVAILABLE",
        "Image storage unavailable.",
        503,
      );
    bytes = await s3ObjectStore(config).get(asset.object, asset);
  }
  if (
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.digest
  )
    throw new AppError("ASSET_UNAVAILABLE", "Image unavailable.", 503);
  return { asset, bytes };
}
