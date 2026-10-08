import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import {
  assetByteLimit,
  parseAssetConfig,
  type AssetConfig,
} from "@/lib/config/assets";
import { workspaceTransaction, type WorkspaceActor } from "./transaction";
import type { PrivateAsset } from "./assets";
import {
  s3ObjectStore,
  type ObjectReference,
  type PrivateObjectStore,
} from "./object-store";

export type StoredAsset = Omit<PrivateAsset, "base64"> & {
  base64?: string;
  object?: ObjectReference;
};
export type StagedAsset = PrivateAsset & {
  object?: ObjectReference;
  stageId?: string;
};
export type AssetStage = {
  _id: string;
  uid: string;
  workspaceId: string;
  assetId: string;
  state: "uploading" | "ready" | "attached" | "deleting" | "deleted";
  object: ObjectReference;
  digest: string;
  bytes: number;
  createdAt: Date;
  deleteLease?: string;
  deleteLeaseUntil?: Date;
  nextDeleteAt?: Date;
  deleteAttempts?: number;
  deleteFailed?: boolean;
  deletedAt?: Date;
};
export const assetStages = (db: Db) =>
  db.collection<AssetStage>("workspaceAssetStages");
const records = (db: Db) => db.collection<StoredAsset>("workspaceAssets");
export async function createAssetStorageIndexes(db: Db) {
  await assetStages(db).createIndex({ state: 1, createdAt: 1 });
  await assetStages(db).createIndex({ uid: 1, state: 1 });
  await assetStages(db).createIndex({ state: 1, nextDeleteAt: 1 });
}
const conflict = (message: string) =>
  new AppError("ASSET_CONFLICT", message, 409);

export function privateAssetStore(
  db: Db,
  config = parseAssetConfig(process.env),
  objectStore?: PrivateObjectStore,
) {
  const remote = () => {
    if (config.mode !== "s3")
      throw new AppError(
        "ASSET_STORAGE_UNAVAILABLE",
        "Restore the configured private object store to access these bytes.",
        503,
      );
    return objectStore ?? s3ObjectStore(config);
  };
  return {
    // No network operation runs in a retried MongoDB transaction. The random stage
    // key belongs to one upload attempt and is never reused by a different object.
    async stage(
      asset: PrivateAsset,
      actor: WorkspaceActor,
    ): Promise<StagedAsset> {
      if (asset.bytes > assetByteLimit(config))
        throw new AppError(
          "ASSET_TOO_LARGE",
          "This asset exceeds the configured storage limit.",
          413,
        );
      if (config.mode === "mongo") return asset;
      const store = remote();
      const stageId = randomUUID();
      const stage: AssetStage = {
        _id: stageId,
        uid: asset.uid,
        workspaceId: asset.workspaceId,
        assetId: asset._id,
        state: "uploading",
        object: { storeId: store.id, key: store.key(stageId) },
        digest: asset.digest,
        bytes: asset.bytes,
        createdAt: new Date(),
      };
      await workspaceTransaction(db, actor, async (session) => {
        if (
          actor.uid !== asset.uid ||
          !(await db
            .collection<{ _id: string; uid: string; deletedAt?: Date }>(
              "workspaces",
            )
            .findOne(
              {
                _id: asset.workspaceId,
                uid: actor.uid,
                archivedAt: null,
                deletedAt: { $exists: false },
              },
              { session },
            ))
        )
          throw new AppError("NOT_FOUND", "Workspace not found.", 404);
        const pending = await assetStages(db).countDocuments(
          {
            uid: actor.uid,
            state: { $in: ["uploading", "ready", "deleting"] },
          },
          { session },
        );
        if (pending >= 20)
          throw conflict(
            "There are too many unclaimed uploads. Ask an administrator to clean up abandoned uploads before continuing.",
          );
        await assetStages(db).insertOne(stage, { session });
      });
      const reference = await store.put(
        stage.object.key,
        Buffer.from(asset.base64, "base64"),
        asset.mime,
        asset.digest,
      );
      const saved = await assetStages(db).updateOne(
        { _id: stageId, state: "uploading" },
        { $set: { object: reference, state: "ready" } },
      );
      if (!saved.matchedCount)
        throw conflict("This staged upload expired. Upload again.");
      return { ...asset, object: reference, stageId };
    },
    async put(asset: StagedAsset, session: ClientSession) {
      if (asset.object) {
        const attached = await assetStages(db).updateOne(
          {
            _id: asset.stageId,
            uid: asset.uid,
            workspaceId: asset.workspaceId,
            assetId: asset._id,
            state: "ready",
            digest: asset.digest,
            createdAt: { $gt: new Date(Date.now() - 86_400_000) },
          },
          { $set: { state: "attached" } },
          { session },
        );
        if (!attached.matchedCount)
          throw conflict("This staged upload is unavailable. Upload again.");
        const metadata: StoredAsset & { stageId?: string } = { ...asset };
        delete metadata.base64;
        delete metadata.stageId;
        await records(db).insertOne(metadata, { session });
      } else {
        if (asset.bytes > assetByteLimit({ mode: "mongo" }))
          throw new AppError(
            "ASSET_TOO_LARGE",
            "Inline private assets are limited to 8 MiB.",
            413,
          );
        await records(db).insertOne(asset, { session });
      }
    },
    async get(uid: string, id: string): Promise<PrivateAsset | null> {
      const asset = await records(db).findOne({ _id: id, uid });
      if (!asset) return null;
      // Old inline assets remain readable when S3 is enabled.
      if (asset.base64 !== undefined) return { ...asset, base64: asset.base64 };
      if (!asset.object) throw conflict("Asset bytes are unavailable.");
      const bytes = await remote().get(asset.object, {
        bytes: asset.bytes,
        digest: asset.digest,
      });
      return { ...asset, base64: bytes.toString("base64") };
    },
  };
}

// Cleanup first fences a stage as deleting in a transaction. This operation is
// repeatable after a crash, and uses an exact version ID when storage supplies one.
async function removeStagedObject(
  db: Db,
  stage: AssetStage,
  config: AssetConfig = parseAssetConfig(process.env),
  objectStore?: PrivateObjectStore,
) {
  if (stage.state !== "deleting" || config.mode !== "s3")
    throw conflict("This upload has not been approved for cleanup.");
  const current = await assetStages(db).findOne({
    _id: stage._id,
    state: "deleting",
  });
  if (!current) return;
  const store = objectStore ?? s3ObjectStore(config);
  const object = await store.head(current.object);
  if (object) {
    if (object.digest !== current.digest || object.bytes !== current.bytes)
      throw conflict(
        "Stored object identity changed; cleanup requires investigation.",
      );
    await store.remove({
      ...current.object,
      ...(object.versionId ? { versionId: object.versionId } : {}),
    });
  }
}

// Only administrator-approved stages enter this queue. A lost lease can repeat
// an exact-key deletion, but cannot settle a newer worker's claim.
export async function processOneAssetDeletion(
  db: Db,
  config: AssetConfig = parseAssetConfig(process.env),
  objectStore?: PrivateObjectStore,
  now = new Date(),
) {
  const lease = randomUUID();
  const stage = await assetStages(db).findOneAndUpdate(
    {
      state: "deleting",
      nextDeleteAt: { $lte: now },
      $or: [
        { deleteLeaseUntil: { $exists: false } },
        { deleteLeaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        deleteLease: lease,
        deleteLeaseUntil: new Date(now.getTime() + 120000),
      },
      $inc: { deleteAttempts: 1 },
    },
    { sort: { nextDeleteAt: 1, _id: 1 }, returnDocument: "after" },
  );
  if (!stage) return false;
  try {
    await removeStagedObject(db, stage, config, objectStore);
    await assetStages(db).updateOne(
      { _id: stage._id, state: "deleting", deleteLease: lease },
      {
        $set: { state: "deleted", deletedAt: new Date(), deleteFailed: false },
        $unset: { deleteLease: "", deleteLeaseUntil: "", nextDeleteAt: "" },
      },
    );
  } catch {
    await assetStages(db).updateOne(
      { _id: stage._id, state: "deleting", deleteLease: lease },
      {
        $set: {
          deleteFailed: true,
          nextDeleteAt: new Date(
            now.getTime() +
              Math.min(3600000, 60000 * (stage.deleteAttempts ?? 1)),
          ),
        },
        $unset: { deleteLease: "", deleteLeaseUntil: "" },
      },
    );
    throw new AppError(
      "ASSET_STORAGE_UNAVAILABLE",
      "Approved asset removal failed; the maintenance worker will retry. Check private storage configuration and permissions.",
      503,
    );
  }
  return true;
}
