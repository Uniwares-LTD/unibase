import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { GridFSBucket, ObjectId, type ClientSession, type Db } from "mongodb";
import { z } from "zod";
import { AppError } from "../auth-policy";
import { parseInput } from "../input";
import { parseAssetConfig } from "../config/assets";
import { readSettings } from "./settings";
import { readWallet } from "./store/credits";
import type { CreditActor } from "./store/credit-types";
import { validateAiFile, aiFiles } from "./ai/files";
import { validatedImage } from "./runs/image";
import { s3ObjectStore, type ObjectReference } from "./runs/object-store";
import { PAGE_SIZE, pageCursor, readCursor } from "./pagination";

export type PrivateFile = {
  _id: string;
  uid: string;
  name: string;
  mime: string;
  bytes: number;
  digest: string;
  requestHash: string;
  state: "staging" | "ready" | "deleting" | "deleted";
  gridId?: ObjectId;
  object?: ObjectReference;
  references: string[];
  createdAt: Date;
  updatedAt: Date;
  lease?: string;
  nextDeleteAt?: Date;
};
const records = (db: Db) => db.collection<PrivateFile>("privateFiles");
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const fileId = z.string().regex(/^[a-f0-9]{64}$/);
const bucket = (db: Db) =>
  new GridFSBucket(db, { bucketName: "privateFileBytes" });
export const fileDto = (file: PrivateFile) => ({
  id: file._id,
  name: file.name,
  mime: file.mime,
  bytes: file.bytes,
  state: file.state,
  createdAt: file.createdAt.toISOString(),
});
export async function ownedFile(
  db: Db,
  uid: string,
  id: string,
  session?: ClientSession,
) {
  parseInput(fileId, id);
  const file = await records(db).findOne(
    { _id: id, uid, state: { $ne: "deleted" } },
    { session },
  );
  if (!file) throw new AppError("FILE_NOT_FOUND", "File unavailable.", 404);
  return file;
}
export async function fileUsage(db: Db, uid: string, session?: ClientSession) {
  const managed = await records(db)
    .find(
      { uid, state: { $ne: "deleted" } },
      { session, projection: { bytes: 1 } },
    )
    .limit(101)
    .toArray();
  const legacy = await aiFiles(db)
    .find(
      { uid, cleanedAt: { $exists: false }, managedFileId: { $exists: false } },
      { session, projection: { bytes: 1 } },
    )
    .limit(101)
    .toArray();
  return {
    count: managed.length + legacy.length,
    bytes: [...managed, ...legacy].reduce((n, f) => n + f.bytes, 0),
  };
}
export async function listFiles(db: Db, uid: string, cursor?: string) {
  const scope = ["files", uid];
  const after = readCursor(cursor, scope);
  if (
    after &&
    (typeof after.value !== "string" ||
      !Number.isFinite(Date.parse(after.value)))
  )
    throw new AppError("INVALID_INPUT", "Invalid page cursor.");
  const rows = await records(db)
    .find({
      uid,
      state: { $ne: "deleted" },
      ...(after
        ? {
            $or: [
              { createdAt: { $lt: new Date(after.value) } },
              { createdAt: new Date(after.value), _id: { $lt: after.id } },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();
  const shown = rows.slice(0, PAGE_SIZE),
    last = shown.at(-1);
  return {
    rows: shown.map(fileDto),
    next:
      rows.length > PAGE_SIZE && last
        ? pageCursor(scope, last.createdAt.toISOString(), last._id)
        : null,
    usage: await fileUsage(db, uid),
  };
}
export async function saveFile(
  db: Db,
  actor: CreditActor,
  key: string,
  file: File,
) {
  parseInput(z.string().uuid(), key);
  const type = validateAiFile(file);
  const policy = (await readSettings(db)).settings.runs;
  if (file.size > policy.uploadBytes)
    throw new AppError(
      "FILE_TOO_LARGE",
      "File exceeds the configured limit.",
      413,
    );
  const original = Buffer.from(await file.arrayBuffer());
  const normalized =
    type === "image"
      ? await validatedImage(
          original.toString("base64"),
          policy.uploadBytes,
          policy.imagePixels,
        )
      : { bytes: original, mime: file.type };
  const id = hash(JSON.stringify([actor.uid, key]));
  const requestHash = hash(
    JSON.stringify([file.name, file.type, hash(original)]),
  );
  const config = parseAssetConfig(process.env);
  const store = config.mode === "s3" ? s3ObjectStore(config) : undefined;
  let created = false;
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
      created = false;
      const prior = await records(db).findOne({ _id: id }, { session });
      if (prior) {
        if (prior.requestHash !== requestHash)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "Upload key already used.",
            409,
          );
        return;
      }
      const usage = await fileUsage(db, actor.uid, session);
      if (
        usage.count >= policy.filesPerAccount ||
        usage.bytes + normalized.bytes.length > policy.uploadBytesPerAccount
      )
        throw new AppError("FILE_QUOTA", "Private file quota exceeded.", 409);
      const now = new Date();
      await records(db).insertOne(
        {
          _id: id,
          uid: actor.uid,
          name:
            type === "image"
              ? file.name.replace(/\.[^.]+$/, "") + ".png"
              : file.name,
          mime: normalized.mime,
          bytes: normalized.bytes.length,
          digest: hash(normalized.bytes),
          requestHash,
          state: "staging",
          references: [],
          createdAt: now,
          updatedAt: now,
          ...(store
            ? { object: { storeId: store.id, key: store.key(randomUUID()) } }
            : { gridId: new ObjectId() }),
        },
        { session },
      );
      created = true;
    },
  });
  let saved = (await records(db).findOne({ _id: id }))!;
  if (!created) {
    if (saved.state !== "ready")
      throw new AppError(
        "FILE_PENDING",
        "This upload is pending or has been removed.",
        409,
      );
    return fileDto(saved);
  }
  // The quota reservation is durable before any external storage operation.
  if (store && saved.object) {
    const object = await store.put(
      saved.object.key,
      normalized.bytes,
      normalized.mime,
      saved.digest,
    );
    await records(db).updateOne(
      { _id: id, state: "staging" },
      { $set: { object } },
    );
  } else {
    await new Promise<void>((resolve, reject) => {
      const stream = bucket(db).openUploadStreamWithId(saved.gridId!, id, {
        metadata: { digest: saved.digest },
      });
      const timer = setTimeout(
        () => stream.destroy(new Error("Storage deadline")),
        30000,
      );
      stream.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      stream.once("finish", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.end(normalized.bytes);
    });
  }
  await records(db).updateOne(
    { _id: id, state: "staging" },
    { $set: { state: "ready", updatedAt: new Date() } },
  );
  saved = await ownedFile(db, actor.uid, id);
  if (saved.state !== "ready")
    throw new AppError("FILE_PENDING", "File finalization is pending.", 409);
  return fileDto(saved);
}
export async function fileBytes(db: Db, uid: string, id: string) {
  const file = await ownedFile(db, uid, id);
  if (file.state !== "ready")
    throw new AppError("FILE_PENDING", "File is not available yet.", 409);
  let bytes: Buffer;
  if (file.object) {
    const config = parseAssetConfig(process.env);
    if (config.mode !== "s3")
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "File storage unavailable.",
        503,
      );
    bytes = await s3ObjectStore(config).get(file.object, {
      bytes: file.bytes,
      digest: file.digest,
    });
  } else {
    const stream = bucket(db).openDownloadStream(file.gridId!);
    const chunks: Buffer[] = [];
    let total = 0;
    const timer = setTimeout(
      () => stream.destroy(new Error("Storage deadline")),
      30000,
    );
    try {
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > file.bytes) throw new Error("File size mismatch");
        chunks.push(chunk);
      }
    } finally {
      clearTimeout(timer);
      stream.destroy();
    }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length !== file.bytes || hash(bytes) !== file.digest)
    throw new AppError("SERVICE_UNAVAILABLE", "File storage unavailable.", 503);
  return { file, bytes };
}
export async function referenceFile(
  db: Db,
  uid: string,
  id: string,
  reference: string,
  session: ClientSession,
) {
  parseInput(fileId, id);
  const changed = await records(db).updateOne(
    { _id: id, uid, state: "ready" },
    { $addToSet: { references: reference }, $set: { updatedAt: new Date() } },
    { session },
  );
  if (!changed.matchedCount)
    throw new AppError("FILE_NOT_FOUND", "File unavailable.", 404);
}
export async function releaseFileReference(
  db: Db,
  uid: string,
  reference: string,
  session: ClientSession,
) {
  await records(db).updateMany(
    { uid, references: reference },
    { $pull: { references: reference } },
    { session },
  );
}
export async function deleteFile(db: Db, actor: CreditActor, id: string) {
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
      const file = await ownedFile(db, actor.uid, id, session);
      if (file.references.length)
        throw new AppError(
          "FILE_IN_USE",
          "This file is still referenced.",
          409,
        );
      if (file.state === "staging")
        throw new AppError("FILE_PENDING", "Upload is still pending.", 409);
      await records(db).updateOne(
        { _id: id, uid: actor.uid, state: "ready", references: { $size: 0 } },
        { $set: { state: "deleting", nextDeleteAt: new Date() } },
        { session },
      );
    },
  });
}
export async function processOneFileDeletion(db: Db) {
  const now = new Date(),
    lease = randomUUID();
  const file = await records(db).findOneAndUpdate(
    {
      references: { $size: 0 },
      $or: [
        {
          state: "staging",
          createdAt: { $lt: new Date(Date.now() - 86400000) },
        },
        { state: "deleting", nextDeleteAt: { $lte: now } },
      ],
    },
    {
      $set: {
        state: "deleting",
        lease,
        nextDeleteAt: new Date(Date.now() + 180000),
      },
    },
    { returnDocument: "after" },
  );
  if (!file) return false;
  try {
    if (file.object) {
      const config = parseAssetConfig(process.env);
      if (config.mode !== "s3") throw new Error("Storage unavailable");
      const store = s3ObjectStore(config),
        head = await store.head(file.object);
      if (head && (head.digest !== file.digest || head.bytes !== file.bytes))
        throw new Error("Stored file changed");
      await store.remove({
        ...file.object,
        ...(head?.versionId ? { versionId: head.versionId } : {}),
      });
    } else {
      // Also removes orphan chunks from an interrupted GridFS upload.
      await db
        .collection("privateFileBytes.chunks")
        .deleteMany({ files_id: file.gridId });
      await db
        .collection("privateFileBytes.files")
        .deleteOne({ _id: file.gridId });
    }
    await records(db).updateOne(
      { _id: file._id, lease, state: "deleting" },
      {
        $set: { state: "deleted", updatedAt: new Date() },
        $unset: { lease: "" },
      },
    );
  } catch {
    await records(db).updateOne(
      { _id: file._id, lease },
      {
        $set: { nextDeleteAt: new Date(Date.now() + 60000) },
        $unset: { lease: "" },
      },
    );
  }
  return true;
}
