import "server-only";
import type { Db, Document } from "mongodb";
import { parseAssetConfig } from "@/lib/config/assets";
import { s3ObjectStore } from "./object-store";

export async function processOneAssetDeletion(db: Db) {
  const now = new Date();
  const stages = db.collection<Document & { _id: string }>("runAssetStages");
  const token = crypto.randomUUID();
  const stage = await stages.findOneAndUpdate(
    { state: "deleting", nextDeleteAt: { $lte: now } },
    {
      $set: {
        deleteLease: token,
        nextDeleteAt: new Date(now.getTime() + 180000),
      },
    },
    { returnDocument: "after" },
  );
  if (!stage) return false;
  try {
    if (
      stage.productAssetId &&
      !(await db
        .collection<import("./assets").ProductAsset>("productAssets")
        .findOne({
          _id: stage.productAssetId,
          uid: stage.uid,
          state: "deleting",
          references: { $size: 0 },
        }))
    )
      throw new Error("Product reference changed");
    const config = parseAssetConfig(process.env);
    if (config.mode !== "s3") throw new Error("Storage unavailable");
    const store = s3ObjectStore(config);
    if (stage.storeId !== store.id) throw new Error("Storage changed");
    const reference = {
      storeId: stage.storeId,
      key: stage.key,
      ...(stage.versionId ? { versionId: stage.versionId } : {}),
    };
    const existing = await store.head(reference);
    if (
      existing &&
      (existing.digest !== stage.digest || existing.bytes !== stage.bytes)
    )
      throw new Error("Stored object changed");
    await store.remove({
      storeId: stage.storeId,
      key: stage.key,
      ...(stage.versionId ? { versionId: stage.versionId } : {}),
    });
    if (stage.productAssetId)
      await db.collection("productAssets").updateOne(
        {
          _id: stage.productAssetId,
          state: "deleting",
          references: { $size: 0 },
        },
        { $set: { state: "deleted" } },
      );
    await stages.updateOne(
      { _id: stage._id, deleteLease: token },
      {
        $set: { state: "deleted", deleteFailed: false },
        $unset: { deleteLease: "" },
      },
    );
  } catch {
    await stages.updateOne(
      { _id: stage._id, deleteLease: token },
      {
        $set: {
          deleteFailed: true,
          nextDeleteAt: new Date(now.getTime() + 60000),
        },
        $unset: { deleteLease: "" },
      },
    );
  }
  return true;
}
