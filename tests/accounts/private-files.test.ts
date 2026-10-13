import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  saveFile,
  fileBytes,
  fileUsage,
  deleteFile,
  processOneFileDeletion,
  referenceFile,
  releaseFileReference,
  listFiles,
} from "../../src/lib/server/private-files";
import { readWallet } from "../../src/lib/server/store/credits";
import { readSettings } from "../../src/lib/server/settings";
import { domainRegistry } from "../../src/lib/server/domains";

test("managed files reserve quota, deduplicate retries, preserve owned references and recover deletion", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("private-files"),
    actor = { uid: "owner", authTime: 100 };
  try {
    await readSettings(db);
    await db
      .collection("baseSettings")
      .updateOne({}, { $set: { "settings.runs.filesPerAccount": 2 } });
    const key = randomUUID(),
      input = new File(["private text"], "note.txt", { type: "text/plain" });
    const saved = await saveFile(db, actor, key, input);
    assert.equal((await saveFile(db, actor, key, input)).id, saved.id);
    assert.deepEqual(await fileUsage(db, actor.uid), { count: 1, bytes: 12 });
    assert.equal(
      (await fileBytes(db, actor.uid, saved.id)).bytes.toString(),
      "private text",
    );
    await assert.rejects(fileBytes(db, "other", saved.id), {
      code: "FILE_NOT_FOUND",
    });
    await assert.rejects(
      saveFile(
        db,
        actor,
        key,
        new File(["changed"], "note.txt", { type: "text/plain" }),
      ),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    const concurrent = await Promise.allSettled([
      saveFile(db, actor, randomUUID(), input),
      saveFile(db, actor, randomUUID(), input),
    ]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await fileUsage(db, actor.uid)).count, 2);
    await readWallet(db, actor.uid, {
      actor,
      persist: (session) =>
        referenceFile(db, actor.uid, saved.id, "run:fixture", session),
    });
    await assert.rejects(deleteFile(db, actor, saved.id), {
      code: "FILE_IN_USE",
    });
    await readWallet(db, actor.uid, {
      actor,
      persist: (session) =>
        releaseFileReference(db, actor.uid, "run:fixture", session),
    });
    await deleteFile(db, actor, saved.id);
    assert.equal((await fileUsage(db, actor.uid)).count, 2);
    assert.equal(await processOneFileDeletion(db), true);
    assert.equal((await fileUsage(db, actor.uid)).count, 1);
    assert.equal(await processOneFileDeletion(db), false);
    await assert.rejects(fileBytes(db, actor.uid, saved.id), {
      code: "FILE_NOT_FOUND",
    });
    assert.equal((await listFiles(db, "other")).rows.length, 0);
    const { ObjectId } = await import("mongodb");
    const orphan = new ObjectId();
    await db.collection("privateFiles").insertOne({
      _id: "a".repeat(64) as never,
      uid: actor.uid,
      name: "abandoned",
      mime: "text/plain",
      bytes: 5,
      digest: "0".repeat(64),
      requestHash: "old",
      state: "staging",
      gridId: orphan,
      references: [],
      createdAt: new Date(Date.now() - 86400001),
      updatedAt: new Date(),
    });
    await db
      .collection("privateFileBytes.chunks")
      .insertOne({ files_id: orphan, n: 0, data: Buffer.from("stage") });
    assert.equal(await processOneFileDeletion(db), true);
    assert.equal(
      await db
        .collection("privateFileBytes.chunks")
        .countDocuments({ files_id: orphan }),
      0,
    );
    assert.equal((await fileUsage(db, actor.uid)).count, 1);
  } finally {
    await client.close();
    await repl.stop();
  }
});

test("a second registered adapter applies through the same fenced result worker", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("domains");
  try {
    const { queueResultApplication, processOneResultApplication } =
      await import("../../src/lib/server/domain-results");
    const { migrateDomainReferences } =
      await import("../../src/lib/server/domain-migration");
    const registry = domainRegistry([
      {
        id: "fixture",
        version: "1",
        kind: "note",
        picker: { label: "Notes", path: "/api/notes" },
        async own(db, uid, id, session) {
          assert.ok(
            await db.collection("notes").findOne({ id, uid }, { session }),
          );
        },
        async admit(db, uid, id, session) {
          await this.own(db, uid, id, session);
        },
        async apply(db, intent, session) {
          await this.own(db, intent.uid, intent.target.id, session);
          await db
            .collection("notes")
            .updateOne(
              { id: intent.target.id, uid: intent.uid },
              { $inc: { applications: 1 } },
              { session },
            );
        },
      },
    ]);
    await db
      .collection("notes")
      .insertOne({ id: "note", uid: "owner", applications: 0 });
    const job = {
      _id: "fixture-job",
      uid: "owner",
      authTime: 100,
      status: "succeeded",
      run: {
        target: { adapter: "fixture", version: "1", kind: "note", id: "note" },
      },
    } as import("../../src/lib/server/ai/jobs").AiJob;
    await db
      .collection<import("../../src/lib/server/ai/jobs").AiJob>("aiJobs")
      .insertOne(job);
    await readWallet(db, "owner", {
      actor: { uid: "owner", authTime: 100 },
      persist: (session) => queueResultApplication(db, job, session),
    });
    assert.equal(
      await processOneResultApplication(db, undefined, registry),
      true,
    );
    assert.equal(
      await processOneResultApplication(db, undefined, registry),
      false,
    );
    assert.equal(
      (await db.collection("notes").findOne({ id: "note" }))?.applications,
      1,
    );
    assert.throws(() => registry.get("arbitrary-collection", "1"), {
      code: "DOMAIN_UNAVAILABLE",
    });
    await db
      .collection("aiJobs")
      .insertOne({ uid: "owner", run: { artifactId: randomUUID() } });
    assert.equal((await migrateDomainReferences(db)).jobs, 1);
    assert.deepEqual(await migrateDomainReferences(db), {
      jobs: 0,
      applications: 0,
    });
  } finally {
    await client.close();
    await repl.stop();
  }
});
