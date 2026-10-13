import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  artifactRevisionDetails,
  artifactRevisionPage,
  artifactPage,
  type Artifact,
} from "../../src/lib/server/runs/artifacts";

test("artifact images belong to their source revision after Run cleanup and retain ownership boundaries", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("artifact-revisions");
  const artifact: Artifact = {
    id: "artifact",
    uid: "owner",
    title: "Story",
    revision: 3,
    approvedRevision: 3,
    assets: ["old-image", "new-image", "foreign", "unreferenced", "deleted"],
    createdAt: new Date(),
  };
  try {
    await db.collection("artifactRevisions").insertMany([
      {
        artifactId: artifact.id,
        uid: artifact.uid,
        revision: 1,
        jobId: "old-job",
        logicalId: "old-run",
        text: "Old story",
      },
      {
        artifactId: artifact.id,
        uid: artifact.uid,
        revision: 2,
        jobId: "new-job",
        logicalId: "new-run",
        text: "Intermediate story",
      },
      {
        artifactId: artifact.id,
        uid: artifact.uid,
        revision: 3,
        jobId: "new-job",
        logicalId: "new-run",
        text: "New story",
      },
      {
        artifactId: artifact.id,
        uid: "other-owner",
        revision: 4,
        jobId: "new-job",
        text: "Private story",
      },
    ]);
    await db
      .collection<{
        _id: string;
        uid: string;
        jobId: string;
        state: string;
        references: string[];
      }>("productAssets")
      .insertMany([
        {
          _id: "old-image",
          uid: "owner",
          jobId: "old-job",
          state: "ready",
          references: ["artifact:artifact"],
        },
        {
          _id: "new-image",
          uid: "owner",
          jobId: "new-job",
          state: "ready",
          references: ["artifact:artifact"],
        },
        {
          _id: "foreign",
          uid: "other-owner",
          jobId: "new-job",
          state: "ready",
          references: ["artifact:artifact"],
        },
        {
          _id: "unreferenced",
          uid: "owner",
          jobId: "new-job",
          state: "ready",
          references: ["artifact:other"],
        },
        {
          _id: "deleted",
          uid: "owner",
          jobId: "new-job",
          state: "deleted",
          references: ["artifact:artifact"],
        },
      ]);
    // Run records and Run assets are already cleaned; only promoted bytes remain.
    const revisions = await artifactRevisionDetails(db, artifact);
    assert.deepEqual(
      revisions.map((r) => ({ revision: r.revision, assets: r.assets })),
      [
        { revision: 3, assets: ["new-image"] },
        { revision: 2, assets: [] },
        { revision: 1, assets: ["old-image"] },
      ],
    );
    assert.equal(JSON.stringify(revisions).includes("Private story"), false);
  } finally {
    await client.close();
    await repl.stop();
  }
});

test("artifact keyset pages handle equal timestamps and final revision images across pages", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("artifact-pages");
  try {
    const createdAt = new Date();
    await db.collection("artifacts").insertMany(
      Array.from({ length: 106 }, (_, i) => ({
        id: String(i).padStart(3, "0"),
        uid: "owner",
        title: "Example " + i,
        revision: 106,
        approvedRevision: null,
        assets: ["image"],
        createdAt,
      })),
    );
    const seen = [];
    let cursor;
    do {
      const page = await artifactPage(db, "owner", cursor);
      assert.ok(page.rows.length <= 25);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.next ?? undefined;
    } while (cursor);
    assert.equal(seen.length, 106);
    assert.equal(new Set(seen).size, 106);
    const first = await artifactPage(db, "owner");
    await assert.rejects(artifactPage(db, "other", first.next!), {
      code: "INVALID_INPUT",
    });
    await assert.rejects(artifactPage(db, "owner", first.next!, "changed"), {
      code: "INVALID_INPUT",
    });
    assert.equal(
      (await artifactPage(db, "owner", undefined, ".*")).rows.length,
      0,
    );
    const artifact: Artifact = {
      id: "a",
      uid: "owner",
      title: "Example",
      revision: 106,
      approvedRevision: null,
      assets: ["image"],
      createdAt,
    };
    await db.collection("artifactRevisions").insertMany(
      Array.from({ length: 106 }, (_, i) => ({
        artifactId: "a",
        uid: "owner",
        revision: i + 1,
        jobId: "same",
        logicalId: "run",
        text: "text",
      })),
    );
    await db.collection("productAssets").insertOne({
      uid: "owner",
      _id: "image" as never,
      jobId: "same",
      state: "ready",
      references: ["artifact:a"],
    });
    let images = 0,
      count = 0;
    cursor = undefined;
    do {
      const page = await artifactRevisionPage(db, artifact, cursor);
      count += page.rows.length;
      images += page.rows.reduce((n, r) => n + r.assets.length, 0);
      cursor = page.next ?? undefined;
    } while (cursor);
    assert.equal(count, 106);
    assert.equal(images, 1);
  } finally {
    await client.close();
    await repl.stop();
  }
});
