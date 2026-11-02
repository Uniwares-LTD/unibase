import "server-only";
import type { Db, ClientSession } from "mongodb";
import type { RunAsset } from "./media";
import { AppError } from "@/lib/auth-policy";

export type ProductAsset = RunAsset & {
  state: "ready" | "deleting" | "deleted";
  references: string[];
  fence: number;
};
// Copy payloads within MongoDB, outside the publish transaction. Empty references
// keep these private; existing Run-history cleanup also reclaims unreferenced copies.
export async function stageProductAssets(db: Db, uid: string, jobId: string) {
  await db
    .collection<RunAsset>("runAssets")
    .aggregate(
      [
        { $match: { uid, jobId, status: "ready" } },
        { $limit: 10 },
        {
          $project: {
            _id: 1,
            uid: 1,
            logicalId: 1,
            jobId: 1,
            name: 1,
            mime: 1,
            bytes: 1,
            digest: 1,
            base64: 1,
            object: 1,
            variants: 1,
            status: 1,
            createdAt: 1,
            state: { $literal: "ready" },
            references: { $literal: [] },
            fence: { $literal: 0 },
          },
        },
        {
          $merge: {
            into: "productAssets",
            on: "_id",
            whenMatched: "keepExisting",
            whenNotMatched: "insert",
          },
        },
      ],
      { maxTimeMS: 120000, timeoutMS: 125000 },
    )
    .toArray();
}
export async function promoteAsset(
  db: Db,
  uid: string,
  jobId: string,
  id: string,
  reference: string,
  session: ClientSession,
) {
  const assets = db.collection<ProductAsset>("productAssets");
  const old = await assets.findOne(
    { _id: id, uid },
    {
      session,
      projection: {
        _id: 1,
        state: 1,
        references: 1,
        jobId: 1,
        digest: 1,
        bytes: 1,
      },
    },
  );
  if (old) {
    if (old.state !== "ready")
      throw new AppError("ASSET_UNAVAILABLE", "Image is being removed.", 409);
    if (old.jobId !== jobId)
      throw new AppError("ASSET_UNAVAILABLE", "Image ownership changed.", 409);
    if (!old.references.length) {
      const source = await db
        .collection<RunAsset>("runAssets")
        .findOneAndUpdate(
          {
            _id: id,
            uid,
            jobId,
            status: "ready",
            digest: old.digest,
            bytes: old.bytes,
          },
          { $set: { retained: true } },
          { session, projection: { _id: 1 } },
        );
      if (!source)
        throw new AppError(
          "ASSET_NOT_FOUND",
          "Owned Run image unavailable.",
          404,
        );
    }
    await assets.updateOne(
      { _id: id, state: "ready" },
      { $addToSet: { references: reference }, $inc: { fence: 1 } },
      { session },
    );
    return;
  }
  const source = await db
    .collection<RunAsset>("runAssets")
    .findOneAndUpdate(
      { _id: id, uid, jobId, status: "ready" },
      { $set: { retained: true } },
      { session },
    );
  if (!source)
    throw new AppError("ASSET_NOT_FOUND", "Owned Run image unavailable.", 404);
  await assets.insertOne(
    { ...source, state: "ready", references: [reference], fence: 0 },
    { session },
  );
}
export async function releaseAssetReference(
  db: Db,
  uid: string,
  reference: string,
  session: ClientSession,
) {
  const records = db.collection<ProductAsset>("productAssets");
  const assets = await records
    .find({ uid, state: "ready", references: reference }, { session })
    .toArray();
  for (const asset of assets) {
    const remaining = asset.references.filter((r) => r !== reference);
    await records.updateOne(
      { _id: asset._id, state: "ready" },
      { $set: { references: remaining }, $inc: { fence: 1 } },
      { session },
    );
    // Run history still owns the object until its cleanup finishes.
    if (
      !remaining.length &&
      !(await db
        .collection<RunAsset>("runAssets")
        .findOne({ _id: asset._id }, { session }))
    )
      await scheduleAssetDeletion(db, asset, session);
  }
}
export async function scheduleAssetDeletion(
  db: Db,
  asset: ProductAsset,
  session: ClientSession,
) {
  const changed = await db.collection<ProductAsset>("productAssets").updateOne(
    {
      _id: asset._id,
      uid: asset.uid,
      state: "ready",
      references: { $size: 0 },
    },
    {
      $set: { state: asset.object ? "deleting" : "deleted" },
      // Display variants are copies of the image and leave with the payload.
      $unset: { base64: "", variants: "" },
      $inc: { fence: 1 },
    },
    { session },
  );
  if (!changed.matchedCount) return;
  if (asset.object)
    await db.collection<{ _id: string }>("runAssetStages").updateOne(
      { _id: asset._id },
      {
        $set: {
          uid: asset.uid,
          productAssetId: asset._id,
          state: "deleting",
          storeId: asset.object.storeId,
          key: asset.object.key,
          ...(asset.object.versionId
            ? { versionId: asset.object.versionId }
            : {}),
          digest: asset.digest,
          bytes: asset.bytes,
          nextDeleteAt: new Date(),
        },
      },
      { session, upsert: true },
    );
}
