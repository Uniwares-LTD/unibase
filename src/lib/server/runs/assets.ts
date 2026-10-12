import "server-only";
import type { Db, ClientSession } from "mongodb";
import type { RunAsset } from "./media";
import { AppError } from "@/lib/auth-policy";

export type ProductAsset = RunAsset & {
  state: "ready" | "deleting" | "deleted";
  references: string[];
  fence: number;
};
export async function promoteAsset(
  db: Db,
  uid: string,
  jobId: string,
  id: string,
  reference: string,
  session: ClientSession,
) {
  const assets = db.collection<ProductAsset>("productAssets");
  const old = await assets.findOne({ _id: id, uid }, { session });
  if (old) {
    if (old.state !== "ready")
      throw new AppError("ASSET_UNAVAILABLE", "Image is being removed.", 409);
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
      $unset: { base64: "" },
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
