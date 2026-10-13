import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  artifactRevisionDetails,
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
