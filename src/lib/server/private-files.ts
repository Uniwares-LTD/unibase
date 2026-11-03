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
import { validateAiFile, validateFileKind } from "./ai/files";
import { validatedImage } from "./runs/image";
import { s3ObjectStore, type ObjectReference } from "./runs/object-store";
import { PAGE_SIZE, pageCursor, readCursor } from "./pagination";

/** Resumable files keep their bytes as fixed-size parts after finalization. */
export const FILE_PART_BYTES = 8 * 1024 * 1024;
// Larger part files are streamed; only this much is ever assembled in memory.
const BUFFERED_FILE_LIMIT = 64 * 1024 * 1024;
type FilePart = {
  bytes: number;
  digest: string;
  gridId?: ObjectId;
  object?: ObjectReference;
};
type PartUpload = {
  partBytes: number;
  count: number;
  // "gridfs" or the private object store ID chosen when the upload started.
  store: string;
  parts: Record<string, FilePart>;
  leases?: Record<string, { token: string; until: Date }>;
};
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
  upload?: PartUpload;
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
async function totals(
  collection: ReturnType<Db["collection"]>,
  filter: Record<string, unknown>,
  session?: ClientSession,
) {
  const [row] = await collection
    .aggregate<{ count: number; bytes: number }>(
      [
        { $match: filter },
        {
          $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$bytes" } },
        },
      ],
      { session },
    )
    .toArray();
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}
export async function fileUsage(db: Db, uid: string, session?: ClientSession) {
  const managed = await totals(
    db.collection("privateFiles"),
    { uid, state: { $ne: "deleted" } },
    session,
  );
  const legacy = await totals(
    db.collection("aiFiles"),
    { uid, cleanedAt: { $exists: false }, managedFileId: { $exists: false } },
    session,
  );
  return {
    count: managed.count + legacy.count,
    bytes: managed.bytes + legacy.bytes,
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
  } else await writeGrid(db, saved.gridId!, id, normalized.bytes, saved.digest);
  await records(db).updateOne(
    { _id: id, state: "staging" },
    { $set: { state: "ready", updatedAt: new Date() } },
  );
  saved = await ownedFile(db, actor.uid, id);
  if (saved.state !== "ready")
    throw new AppError("FILE_PENDING", "File finalization is pending.", 409);
  return fileDto(saved);
}
const storageUnavailable = () =>
  new AppError("SERVICE_UNAVAILABLE", "File storage unavailable.", 503);
function objectStore() {
  const config = parseAssetConfig(process.env);
  if (config.mode !== "s3") throw storageUnavailable();
  return s3ObjectStore(config);
}
async function writeGrid(
  db: Db,
  gridId: ObjectId,
  name: string,
  bytes: Buffer,
  digest: string,
) {
  await new Promise<void>((resolve, reject) => {
    const stream = bucket(db).openUploadStreamWithId(gridId, name, {
      metadata: { digest },
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
    stream.end(bytes);
  });
}
async function readGrid(db: Db, gridId: ObjectId, size: number) {
  const stream = bucket(db).openDownloadStream(gridId);
  const chunks: Buffer[] = [];
  let total = 0;
  const timer = setTimeout(
    () => stream.destroy(new Error("Storage deadline")),
    30000,
  );
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > size) throw new Error("File size mismatch");
      chunks.push(chunk);
    }
  } catch {
    throw storageUnavailable();
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
  return Buffer.concat(chunks);
}
async function removeGrid(db: Db, gridId: ObjectId) {
  // Also removes orphan chunks from an interrupted GridFS upload.
  await db
    .collection("privateFileBytes.chunks")
    .deleteMany({ files_id: gridId });
  await db.collection("privateFileBytes.files").deleteOne({ _id: gridId });
}

// Part locations derive from the file and index, so deletion also finds bytes
// from an interrupted write that was never recorded.
function partLocation(
  file: PrivateFile,
  n: number,
): Omit<FilePart, "bytes" | "digest"> {
  const h = hash(JSON.stringify([file._id, "part", n]));
  if (file.upload!.store === "gridfs")
    return { gridId: new ObjectId(h.slice(0, 24)) };
  const store = objectStore();
  if (store.id !== file.upload!.store) throw storageUnavailable();
  const key = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return { object: { storeId: store.id, key: store.key(key) } };
}
async function removePart(
  db: Db,
  file: PrivateFile,
  n: number,
  recorded?: FilePart,
) {
  const location = partLocation(file, n);
  if (location.gridId) return removeGrid(db, location.gridId);
  const store = objectStore(),
    head = await store.head(location.object!);
  if (!head) return;
  if (
    recorded &&
    (head.digest !== recorded.digest || head.bytes !== recorded.bytes)
  )
    throw new Error("Stored file changed");
  await store.remove({
    ...location.object!,
    ...(head.versionId ? { versionId: head.versionId } : {}),
  });
}
async function readPart(db: Db, file: PrivateFile, n: number) {
  const part = file.upload!.parts[n];
  if (!part) throw storageUnavailable();
  const bytes = part.object
    ? await objectStore().get(part.object, part)
    : await readGrid(db, part.gridId!, part.bytes);
  if (bytes.length !== part.bytes || hash(bytes) !== part.digest)
    throw storageUnavailable();
  return bytes;
}
export const uploadDto = (file: PrivateFile) => ({
  file: fileDto(file),
  partBytes: file.upload!.partBytes,
  count: file.upload!.count,
  received: Object.keys(file.upload!.parts)
    .map(Number)
    .sort((a, b) => a - b),
});
async function ownedUpload(db: Db, uid: string, id: string) {
  const file = await ownedFile(db, uid, id);
  if (!file.upload)
    throw new AppError(
      "FILE_NOT_RESUMABLE",
      "This file is not a resumable upload.",
      409,
    );
  return file;
}
export async function uploadStatus(db: Db, uid: string, id: string) {
  return uploadDto(await ownedUpload(db, uid, id));
}

/**
 * Start, or resume with the same key, a resumable upload. The declared size is
 * reserved against the account quota before any bytes are accepted.
 */
export async function startUpload(
  db: Db,
  actor: CreditActor,
  input: { key: string; name: string; mime: string; bytes: number },
) {
  parseInput(z.string().uuid(), input.key);
  const type = validateFileKind({ name: input.name, type: input.mime });
  // Images are normalized as a whole, so they keep the single-request path.
  if (type === "image")
    throw new AppError("FILE_TYPE", "Upload images in a single request.", 415);
  const policy = (await readSettings(db)).settings.runs;
  if (
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > policy.fileBytes
  )
    throw new AppError(
      "FILE_TOO_LARGE",
      "File exceeds the configured limit.",
      413,
    );
  const id = hash(JSON.stringify([actor.uid, input.key]));
  const requestHash = hash(
    JSON.stringify(["parts", input.name, input.mime, input.bytes]),
  );
  const config = parseAssetConfig(process.env);
  const store = config.mode === "s3" ? s3ObjectStore(config) : undefined;
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
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
        usage.bytes + input.bytes > policy.uploadBytesPerAccount
      )
        throw new AppError("FILE_QUOTA", "Private file quota exceeded.", 409);
      const now = new Date();
      await records(db).insertOne(
        {
          _id: id,
          uid: actor.uid,
          name: input.name,
          mime: input.mime,
          bytes: input.bytes,
          // Recorded once every part is stored and verified.
          digest: "",
          requestHash,
          state: "staging",
          upload: {
            partBytes: FILE_PART_BYTES,
            count: Math.ceil(input.bytes / FILE_PART_BYTES),
            store: store?.id ?? "gridfs",
            parts: {},
          },
          references: [],
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
    },
  });
  const saved = await ownedFile(db, actor.uid, id);
  if (saved.state === "deleting")
    throw new AppError("UPLOAD_CLOSED", "This upload was removed.", 409);
  return uploadDto(saved);
}

/** Store one part. Retrying a stored part with identical bytes is a no-op. */
export async function putUploadPart(
  db: Db,
  uid: string,
  id: string,
  n: number,
  bytes: Buffer,
) {
  const file = await ownedUpload(db, uid, id);
  const upload = file.upload!;
  if (file.state === "ready") return uploadDto(file);
  if (file.state !== "staging")
    throw new AppError("UPLOAD_CLOSED", "This upload was removed.", 409);
  if (!Number.isSafeInteger(n) || n < 0 || n >= upload.count)
    throw new AppError("INVALID_INPUT", "Invalid upload part.");
  const expected =
    n === upload.count - 1
      ? file.bytes - n * upload.partBytes
      : upload.partBytes;
  if (bytes.length !== expected)
    throw new AppError("INVALID_INPUT", "Upload part size is incorrect.");
  const digest = hash(bytes);
  const stored = (current: PrivateFile | null) => {
    const part = current?.upload?.parts[n];
    if (!part) return false;
    if (part.digest !== digest)
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This part was already uploaded with different bytes.",
        409,
      );
    return true;
  };
  if (stored(file)) return uploadDto(file);
  const token = randomUUID(),
    now = new Date();
  const leased = await records(db).updateOne(
    {
      _id: id,
      uid,
      state: "staging",
      [`upload.parts.${n}`]: { $exists: false },
      $or: [
        { [`upload.leases.${n}`]: { $exists: false } },
        { [`upload.leases.${n}.until`]: { $lte: now } },
      ],
    },
    {
      $set: {
        // Longer than the removal and write deadlines combined.
        [`upload.leases.${n}`]: {
          token,
          until: new Date(now.getTime() + 120000),
        },
        updatedAt: now,
      },
    },
  );
  if (!leased.matchedCount) {
    const current = await ownedUpload(db, uid, id);
    if (stored(current)) return uploadDto(current);
    throw new AppError(
      "UPLOAD_PART_BUSY",
      "This part is already being uploaded.",
      409,
    );
  }
  let part: FilePart;
  try {
    const location = partLocation(file, n);
    // Clears bytes left by an earlier interrupted attempt at this part.
    await removePart(db, file, n);
    if (location.gridId) {
      await writeGrid(db, location.gridId, `${id}.${n}`, bytes, digest);
      part = { bytes: bytes.length, digest, gridId: location.gridId };
    } else {
      const object = await objectStore().put(
        location.object!.key,
        bytes,
        "application/octet-stream",
        digest,
      );
      part = { bytes: bytes.length, digest, object };
    }
  } catch (error) {
    await records(db).updateOne(
      { _id: id, [`upload.leases.${n}.token`]: token },
      { $unset: { [`upload.leases.${n}`]: "" } },
    );
    if (error instanceof AppError) throw error;
    throw storageUnavailable();
  }
  const recorded = await records(db).findOneAndUpdate(
    { _id: id, state: "staging", [`upload.leases.${n}.token`]: token },
    {
      $set: { [`upload.parts.${n}`]: part, updatedAt: new Date() },
      $unset: { [`upload.leases.${n}`]: "" },
    },
    { returnDocument: "after" },
  );
  if (!recorded) {
    const current = await records(db).findOne({ _id: id });
    // Removal may already have reclaimed this upload; do not leave bytes behind.
    if (current?.state !== "staging")
      await removePart(db, file, n).catch(() => undefined);
    throw new AppError("UPLOAD_CLOSED", "This upload changed.", 409);
  }
  return uploadDto(recorded);
}

/** Verify every stored part, record the whole-file digest and mark it ready. */
export async function completeUpload(db: Db, uid: string, id: string) {
  const file = await ownedUpload(db, uid, id);
  if (file.state === "ready") return fileDto(file);
  if (file.state !== "staging")
    throw new AppError("UPLOAD_CLOSED", "This upload was removed.", 409);
  const upload = file.upload!;
  let total = 0;
  for (let n = 0; n < upload.count; n++) {
    const part = upload.parts[n];
    if (!part)
      throw new AppError(
        "UPLOAD_INCOMPLETE",
        "Some parts have not been uploaded.",
        409,
      );
    total += part.bytes;
  }
  if (total !== file.bytes) throw storageUnavailable();
  const digest = createHash("sha256");
  for (let n = 0; n < upload.count; n++)
    digest.update(await readPart(db, file, n));
  await records(db).updateOne(
    { _id: id, uid, state: "staging" },
    {
      $set: {
        state: "ready",
        digest: digest.digest("hex"),
        updatedAt: new Date(),
      },
      $unset: { "upload.leases": "" },
    },
  );
  const saved = await ownedFile(db, uid, id);
  if (saved.state !== "ready")
    throw new AppError("UPLOAD_CLOSED", "This upload was removed.", 409);
  return fileDto(saved);
}

/** Buffered bytes for bounded consumers such as Run inputs. */
export async function fileBytes(db: Db, uid: string, id: string) {
  const file = await ownedFile(db, uid, id);
  if (file.state !== "ready")
    throw new AppError("FILE_PENDING", "File is not available yet.", 409);
  let bytes: Buffer;
  if (file.upload) {
    if (file.bytes > BUFFERED_FILE_LIMIT)
      throw new AppError(
        "FILE_TOO_LARGE",
        "This file is too large for this use.",
        413,
      );
    const parts: Buffer[] = [];
    for (let n = 0; n < file.upload.count; n++)
      parts.push(await readPart(db, file, n));
    bytes = Buffer.concat(parts);
  } else if (file.object)
    bytes = await objectStore().get(file.object, {
      bytes: file.bytes,
      digest: file.digest,
    });
  else bytes = await readGrid(db, file.gridId!, file.bytes);
  if (bytes.length !== file.bytes || hash(bytes) !== file.digest)
    throw storageUnavailable();
  return { file, bytes };
}

/**
 * Download body. Part files stream one verified part at a time; a part that
 * fails verification errors the stream before the declared length is reached.
 */
export async function fileContent(db: Db, uid: string, id: string) {
  const file = await ownedFile(db, uid, id);
  if (!file.upload || file.state !== "ready") {
    const { bytes } = await fileBytes(db, uid, id);
    return { file, body: new Uint8Array(bytes) };
  }
  // Reading the first part before responding reports unavailable storage as an error.
  const first = await readPart(db, file, 0);
  let n = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (n >= file.upload!.count) return controller.close();
      const bytes = n === 0 ? first : await readPart(db, file, n);
      n++;
      controller.enqueue(new Uint8Array(bytes));
    },
  });
  return { file, body };
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
      // A resumable upload can be abandoned; a single request is still finishing.
      if (file.state === "staging" && !file.upload)
        throw new AppError("FILE_PENDING", "Upload is still pending.", 409);
      await records(db).updateOne(
        {
          _id: id,
          uid: actor.uid,
          state: { $in: file.upload ? ["ready", "staging"] : ["ready"] },
          references: { $size: 0 },
        },
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
          upload: { $exists: false },
          createdAt: { $lt: new Date(Date.now() - 86400000) },
        },
        {
          // Resumable uploads are reclaimed after 24 hours without a stored part.
          state: "staging",
          upload: { $exists: true },
          updatedAt: { $lt: new Date(Date.now() - 86400000) },
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
    if (file.upload)
      for (let n = 0; n < file.upload.count; n++)
        await removePart(db, file, n, file.upload.parts[n]);
    else if (file.object) {
      const store = objectStore(),
        head = await store.head(file.object);
      if (head && (head.digest !== file.digest || head.bytes !== file.bytes))
        throw new Error("Stored file changed");
      await store.remove({
        ...file.object,
        ...(head?.versionId ? { versionId: head.versionId } : {}),
      });
    } else await removeGrid(db, file.gridId!);
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
