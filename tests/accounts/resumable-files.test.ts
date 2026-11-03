import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  FILE_PART_BYTES,
  completeUpload,
  deleteFile,
  fileBytes,
  fileContent,
  fileUsage,
  processOneFileDeletion,
  putUploadPart,
  startUpload,
  uploadStatus,
} from "../../src/lib/server/private-files";
import { readSettings } from "../../src/lib/server/settings";

const actor = { uid: "owner", authTime: 100 };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
// Two full parts and a short final part.
const content = Buffer.concat([
  Buffer.alloc(FILE_PART_BYTES, 1),
  Buffer.alloc(FILE_PART_BYTES, 2),
  Buffer.from("tail"),
]);
const part = (n: number) =>
  content.subarray(n * FILE_PART_BYTES, (n + 1) * FILE_PART_BYTES);

async function withDatabase(run: (db: Db) => Promise<void>) {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  try {
    const db = client.db("resumable-files");
    await readSettings(db);
    await db.collection("baseSettings").updateOne(
      {},
      {
        $set: {
          "settings.runs.fileBytes": 64 * 1024 * 1024,
          "settings.runs.uploadBytesPerAccount": 64 * 1024 * 1024,
        },
      },
    );
    await run(db);
  } finally {
    await client.close();
    await repl.stop();
  }
}
const start = (db: Db, key: string, bytes = content.length) =>
  startUpload(db, actor, {
    key,
    name: "meeting.wav",
    mime: "audio/wav",
    bytes,
  });
async function readBody(body: BodyInit) {
  return Buffer.from(await new Response(body).arrayBuffer());
}

test("resumable uploads reserve quota, resume parts idempotently and verify the whole file", async () => {
  process.env.ASSET_STORE = "mongo";
  await withDatabase(async (db) => {
    const key = randomUUID();
    await assert.rejects(
      startUpload(db, actor, {
        key: randomUUID(),
        name: "scan.png",
        mime: "image/png",
        bytes: 100,
      }),
      { code: "FILE_TYPE" },
    );
    await assert.rejects(start(db, randomUUID(), 65 * 1024 * 1024), {
      code: "FILE_TOO_LARGE",
    });
    const started = await start(db, key);
    assert.equal(started.count, 3);
    assert.deepEqual(started.received, []);
    // The declared size is reserved before any part arrives.
    assert.deepEqual(await fileUsage(db, actor.uid), {
      count: 1,
      bytes: content.length,
    });
    await assert.rejects(start(db, key, 10), { code: "IDEMPOTENCY_CONFLICT" });
    const id = started.file.id;
    await assert.rejects(uploadStatus(db, "other", id), {
      code: "FILE_NOT_FOUND",
    });
    await assert.rejects(
      putUploadPart(db, actor.uid, id, 1, Buffer.from("x")),
      {
        code: "INVALID_INPUT",
      },
    );
    await assert.rejects(putUploadPart(db, actor.uid, id, 3, part(2)), {
      code: "INVALID_INPUT",
    });
    await putUploadPart(db, actor.uid, id, 2, part(2));
    await putUploadPart(db, actor.uid, id, 0, part(0));
    await assert.rejects(completeUpload(db, actor.uid, id), {
      code: "UPLOAD_INCOMPLETE",
    });
    // Resuming with the same key reports the stored parts.
    assert.deepEqual((await start(db, key)).received, [0, 2]);
    assert.equal(
      (await putUploadPart(db, actor.uid, id, 0, part(0))).received.length,
      2,
    );
    await assert.rejects(
      putUploadPart(db, actor.uid, id, 0, Buffer.alloc(FILE_PART_BYTES, 9)),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const concurrent = await Promise.allSettled([
      putUploadPart(db, actor.uid, id, 1, part(1)),
      putUploadPart(db, actor.uid, id, 1, part(1)),
    ]);
    assert(concurrent.some((r) => r.status === "fulfilled"));
    for (const r of concurrent)
      if (r.status === "rejected")
        assert.equal((r.reason as { code: string }).code, "UPLOAD_PART_BUSY");
    if (!(await uploadStatus(db, actor.uid, id)).received.includes(1))
      await putUploadPart(db, actor.uid, id, 1, part(1));
    const completed = await completeUpload(db, actor.uid, id);
    assert.equal(completed.state, "ready");
    assert.equal(completed.bytes, content.length);
    assert.equal((await completeUpload(db, actor.uid, id)).state, "ready");
    const stored = await db
      .collection<{ _id: string; digest: string }>("privateFiles")
      .findOne({ _id: id });
    assert.equal(stored?.digest, sha(content));
    assert(sha((await fileBytes(db, actor.uid, id)).bytes) === sha(content));
    const download = await fileContent(db, actor.uid, id);
    assert.equal(sha(await readBody(download.body)), sha(content));

    // A corrupted stored part fails verification instead of serving bytes.
    await db
      .collection("privateFileBytes.chunks")
      .updateOne({}, { $set: { data: Buffer.alloc(16, 7) } });
    await assert.rejects(fileBytes(db, actor.uid, id), {
      code: "SERVICE_UNAVAILABLE",
    });

    await deleteFile(db, actor, id);
    assert.equal(await processOneFileDeletion(db), true);
    assert.equal(
      await db.collection("privateFileBytes.files").countDocuments(),
      0,
    );
    assert.equal(
      await db.collection("privateFileBytes.chunks").countDocuments(),
      0,
    );
    assert.deepEqual(await fileUsage(db, actor.uid), { count: 0, bytes: 0 });
  });
});

test("abandoned resumable uploads can be removed and idle ones are reclaimed with their parts", async () => {
  process.env.ASSET_STORE = "mongo";
  await withDatabase(async (db) => {
    const abandoned = await start(db, randomUUID());
    await putUploadPart(db, actor.uid, abandoned.file.id, 0, part(0));
    await deleteFile(db, actor, abandoned.file.id);
    await assert.rejects(
      putUploadPart(db, actor.uid, abandoned.file.id, 1, part(1)),
      { code: "UPLOAD_CLOSED" },
    );
    assert.equal(await processOneFileDeletion(db), true);

    const idle = await start(db, randomUUID());
    await putUploadPart(db, actor.uid, idle.file.id, 0, part(0));
    // Simulate a write that stored bytes but never recorded its part.
    await putUploadPart(db, actor.uid, idle.file.id, 1, part(1));
    await db
      .collection("privateFiles")
      .updateOne(
        { _id: idle.file.id as never },
        { $unset: { "upload.parts.1": "" } },
      );
    assert.equal(await processOneFileDeletion(db), false);
    await db
      .collection("privateFiles")
      .updateOne(
        { _id: idle.file.id as never },
        { $set: { updatedAt: new Date(Date.now() - 2 * 86400000) } },
      );
    assert.equal(await processOneFileDeletion(db), true);
    assert.equal(
      await db.collection("privateFileBytes.files").countDocuments(),
      0,
    );
    assert.deepEqual(await fileUsage(db, actor.uid), { count: 0, bytes: 0 });
  });
});

test("resumable parts use private object storage and deletion removes every part", async () => {
  const objects = new Map<string, { bytes: Buffer; digest: string }>();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    if (req.method === "PUT") {
      if (objects.has(path)) return void res.writeHead(412).end();
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(path, {
        bytes: Buffer.concat(chunks),
        digest: String(req.headers["x-amz-meta-sha256"]),
      });
      return void res.writeHead(200, { etag: '"fixture"' }).end();
    }
    const value = objects.get(path);
    if (!value) return void res.writeHead(404).end();
    if (req.method === "DELETE") {
      objects.delete(path);
      return void res.writeHead(204).end();
    }
    res.writeHead(200, {
      "content-length": value.bytes.length,
      "x-amz-meta-sha256": value.digest,
    });
    res.end(req.method === "HEAD" ? undefined : value.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { ...process.env };
  Object.assign(process.env, {
    ASSET_STORE: "s3",
    ASSET_S3_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    ASSET_S3_REGION: "local",
    ASSET_S3_BUCKET: "fixture-bucket",
    ASSET_S3_PREFIX: "fixture",
    ASSET_S3_ACCESS_KEY_ID: "fixture",
    ASSET_S3_SECRET_ACCESS_KEY: "fixture",
    ASSET_S3_FORCE_PATH_STYLE: "true",
    APP_ENV: "local",
  });
  try {
    await withDatabase(async (db) => {
      const started = await start(db, randomUUID());
      for (let n = 0; n < started.count; n++)
        await putUploadPart(db, actor.uid, started.file.id, n, part(n));
      assert.equal(objects.size, 3);
      await completeUpload(db, actor.uid, started.file.id);
      const download = await fileContent(db, actor.uid, started.file.id);
      assert.equal(sha(await readBody(download.body)), sha(content));
      await deleteFile(db, actor, started.file.id);
      assert.equal(await processOneFileDeletion(db), true);
      assert.equal(objects.size, 0);
    });
  } finally {
    process.env = previous;
    server.close();
  }
});
