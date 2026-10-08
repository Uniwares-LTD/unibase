import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  appointFirstAdmin,
  changeAccess,
} from "../../src/lib/server/store/access";
import {
  previewCleanup,
  executeCleanup,
  recentCleanupReports,
} from "../../src/lib/server/store/cleanup";
import {
  assetStages,
  privateAssetStore,
  processOneAssetDeletion,
  createAssetStorageIndexes,
} from "../../src/lib/server/workspaces/asset-storage";
import { workspaceTransaction } from "../../src/lib/server/workspaces/transaction";
import { assetRecord } from "../../src/lib/server/workspaces/assets";
import type { AssetConfig } from "../../src/lib/config/assets";
import type {
  PrivateObjectStore,
  ObjectReference,
} from "../../src/lib/server/workspaces/object-store";

const config: AssetConfig = {
  mode: "s3",
  endpoint: "http://127.0.0.1:1",
  region: "test",
  bucket: "test-bucket",
  prefix: "assets",
  accessKeyId: "fixture",
  secretAccessKey: "fixture",
  forcePathStyle: true,
};

test("private asset storage: owned staging and approved recoverable cleanup", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("asset-storage");
  const owner = { uid: "owner", authTime: 1 };
  const admin = { uid: "admin", authTime: 1 };
  const workspaceId = randomUUID();
  const objects = new Map<
    string,
    { bytes: Buffer; digest: string; versionId: string }
  >();
  let puts = 0,
    deletes = 0;
  let failPut = false,
    failDelete = false;
  const remote: PrivateObjectStore = {
    id: "fixture",
    key: (id) => `assets/${id}`,
    async put(key, bytes, _mime, digest) {
      puts++;
      const versionId = randomUUID();
      objects.set(key, { bytes, digest, versionId });
      if (failPut) throw new Error("unknown PUT outcome");
      return { storeId: "fixture", key, versionId };
    },
    async get(ref, expected) {
      const object = objects.get(ref.key);
      assert.ok(object);
      assert.equal(object.digest, expected.digest);
      return object.bytes;
    },
    async head(ref) {
      const object = objects.get(ref.key);
      return object
        ? {
            bytes: object.bytes.length,
            digest: object.digest,
            versionId: object.versionId,
          }
        : null;
    },
    async remove(ref: ObjectReference) {
      deletes++;
      if (failDelete)
        throw new Error("private credential detail must not persist");
      assert.equal(ref.versionId, objects.get(ref.key)?.versionId);
      objects.delete(ref.key);
    },
  };
  const store = privateAssetStore(db, config, remote);
  const asset = () =>
    assetRecord(
      randomUUID(),
      owner.uid,
      workspaceId,
      "image.png",
      Buffer.from("fixture bytes"),
      "image/png",
    );
  const old = new Date(Date.now() - 3 * 86400000);
  try {
    await appointFirstAdmin(db, admin.uid, "fixture");
    await createAssetStorageIndexes(db);
    await db
      .collection<{ _id: string; uid: string }>("workspaces")
      .insertOne({ _id: workspaceId, uid: owner.uid });
    await t.test(
      "cross-owner staging fails before remote writes; attachment commits metadata without bytes",
      async () => {
        await assert.rejects(
          store.stage(asset(), { uid: "other", authTime: 1 }),
        );
        assert.equal(puts, 0);
        const staged = await store.stage(asset(), owner);
        assert.equal(
          (await assetStages(db).findOne({ _id: staged.stageId }))?.state,
          "ready",
        );
        await workspaceTransaction(db, owner, async (session) => {
          await store.put(staged, session);
        });
        const metadata = await db
          .collection("workspaceAssets")
          .findOne({ _id: staged._id as never });
        assert.equal(metadata?.base64, undefined);
        assert.equal(metadata?.stageId, undefined);
        assert.equal(
          (await assetStages(db).findOne({ _id: staged.stageId }))?.state,
          "attached",
        );
        assert.equal(
          (await store.get(owner.uid, staged._id))?.base64,
          staged.base64,
        );
        assert.equal(await store.get("other", staged._id), null);
        const beforeArchive = puts;
        await db
          .collection("workspaces")
          .updateOne(
            { _id: workspaceId as never },
            { $set: { archivedAt: new Date().toISOString() } },
          );
        await assert.rejects(store.stage(asset(), owner));
        assert.equal(puts, beforeArchive);
        await db
          .collection("workspaces")
          .updateOne(
            { _id: workspaceId as never },
            { $unset: { archivedAt: "" } },
          );
        await assert.rejects(
          workspaceTransaction(db, owner, (session) =>
            store.put(staged, session),
          ),
        );
      },
    );
    await t.test(
      "preview is read-only; approval skips attached targets, is replay-safe and preserves evidence",
      async () => {
        const keep = await store.stage(asset(), owner);
        const remove = await store.stage(asset(), owner);
        await assetStages(db).updateMany({}, { $set: { createdAt: old } });
        const report = await previewCleanup(db, admin, {
          scope: "abandoned-uploads",
          olderThanDays: 1,
          limit: 100,
        });
        assert.equal(report.abandonedUploads, 2);
        assert.equal(report.jobs + report.files, 0);
        assert.equal(await processOneAssetDeletion(db, config, remote), false);
        assert.equal(deletes, 0);
        // An attachment won the race after preview; cleanup must skip it.
        await assetStages(db).updateOne(
          { _id: keep.stageId },
          { $set: { state: "attached" } },
        );
        await db.collection("creditLedger").insertOne({ evidence: "preserve" });
        const result = await executeCleanup(
          db,
          admin,
          report.id,
          "Remove abandoned private bytes",
        );
        assert.equal(result.changed, 1);
        assert.equal(result.skipped, 1);
        assert.equal(result.storagePending, 1);
        assert.equal(deletes, 0);
        assert.deepEqual(
          await executeCleanup(db, admin, report.id, "Replay approved cleanup"),
          result,
        );
        failDelete = true;
        await assert.rejects(
          processOneAssetDeletion(db, config, remote),
          /Approved asset removal failed/,
        );
        const failed = await assetStages(db).findOne({ _id: remove.stageId });
        assert.equal(failed?.state, "deleting");
        assert.equal(failed?.deleteFailed, true);
        assert.ok(!JSON.stringify(failed).includes("credential"));
        assert.equal((await recentCleanupReports(db))[0].storageFailed, 1);
        assert.equal(await processOneAssetDeletion(db, config, remote), false);
        failDelete = false;
        assert.ok(
          await processOneAssetDeletion(
            db,
            config,
            remote,
            new Date(Date.now() + 61000),
          ),
        );
        const done = await executeCleanup(
          db,
          admin,
          report.id,
          "Read updated cleanup report",
        );
        assert.equal(done.storagePending, 0);
        assert.equal(done.storageDeleted, 1);
        assert.equal(done.storageFailed, 0);
        assert.equal(await db.collection("creditLedger").countDocuments(), 1);
        assert.equal(
          await db
            .collection("auditEvents")
            .countDocuments({ event: "ai-cleanup" }),
          1,
        );
        assert.ok(objects.has(keep.object!.key));
      },
    );
    await t.test(
      "unknown PUT is tracked and exact version is removed; a lost lease resumes after expiry",
      async () => {
        failPut = true;
        await assert.rejects(store.stage(asset(), owner));
        failPut = false;
        const unknown = await assetStages(db).findOne({ state: "uploading" });
        assert.ok(unknown && objects.has(unknown.object.key));
        await assetStages(db).updateOne(
          { _id: unknown._id },
          { $set: { createdAt: old } },
        );
        const report = await previewCleanup(db, admin, {
          scope: "abandoned-uploads",
          olderThanDays: 1,
          limit: 100,
        });
        await executeCleanup(
          db,
          admin,
          report.id,
          "Remove uncertain staged object",
        );
        const expiry = new Date(Date.now() + 120000);
        await assetStages(db).updateOne(
          { _id: unknown._id },
          { $set: { deleteLease: "crashed", deleteLeaseUntil: expiry } },
        );
        assert.equal(await processOneAssetDeletion(db, config, remote), false);
        assert.ok(await processOneAssetDeletion(db, config, remote, expiry));
        assert.equal(objects.has(unknown.object.key), false);
      },
    );
    await t.test(
      "changed object identity is retained and reported; demotion prevents approval",
      async () => {
        const staged = await store.stage(asset(), owner);
        await assetStages(db).updateOne(
          { _id: staged.stageId },
          { $set: { createdAt: old } },
        );
        const report = await previewCleanup(db, admin, {
          scope: "abandoned-uploads",
          olderThanDays: 1,
          limit: 100,
        });
        await assert.rejects(
          executeCleanup(db, owner, report.id, "Owner is not administrator"),
        );
        await executeCleanup(
          db,
          admin,
          report.id,
          "Approved abandoned object cleanup",
        );
        objects.get(staged.object!.key)!.digest = "changed";
        const before = deletes;
        await assert.rejects(processOneAssetDeletion(db, config, remote));
        assert.equal(deletes, before);
        assert.ok(objects.has(staged.object!.key));
        await changeAccess(
          db,
          admin.uid,
          "admin2",
          { role: "admin", status: "active" },
          "fixture",
          1,
        );
        const next = await previewCleanup(db, admin, {
          scope: "abandoned-uploads",
          olderThanDays: 1,
          limit: 10,
        });
        await changeAccess(
          db,
          "admin2",
          admin.uid,
          { role: "member", status: "active" },
          "fixture demotion",
          1,
        );
        await assert.rejects(
          executeCleanup(db, admin, next.id, "Demoted admin cannot approve"),
        );
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
