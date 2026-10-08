import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { appointFirstAdmin } from "../../src/lib/server/store/access";
import {
  previewCleanup,
  executeCleanup,
} from "../../src/lib/server/store/cleanup";
import {
  createWorkspace,
  commandWorkspace,
  ownedWorkspace,
  createWorkspaceIndexes,
  workspaceView,
  type Workspace,
} from "../../src/lib/server/workspaces/store";
import { assetRecord } from "../../src/lib/server/workspaces/assets";
import {
  assetStages,
  privateAssetStore,
} from "../../src/lib/server/workspaces/asset-storage";
import { aiJobs, createAiJob } from "../../src/lib/server/ai/jobs";

test("workspace lifecycle: archive, previewed erasure and durable retry evidence", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("lifecycle");
  const owner = { uid: "owner", authTime: 1 },
    admin = { uid: "admin", authTime: 1 };
  const old = new Date(Date.now() - 40 * 86400000);
  const workspaces = db.collection<Workspace>("workspaces");
  async function change(workspace: Workspace, action: Record<string, unknown>) {
    return commandWorkspace(db, owner, workspace.id, {
      key: randomUUID(),
      expectedUid: owner.uid,
      revision: workspace.revision,
      ...action,
    } as never);
  }
  async function archived(title: string) {
    let workspace = await createWorkspace(db, owner, randomUUID(), title);
    workspace = await change(workspace, { action: "archive", archived: true });
    await workspaces.updateOne(
      { _id: workspace.id },
      { $set: { archivedAt: old.toISOString() } },
    );
    return ownedWorkspace(db, owner.uid, workspace.id);
  }
  const preview = () =>
    previewCleanup(db, admin, {
      scope: "archived-workspaces",
      olderThanDays: 30,
      limit: 100,
    });
  try {
    await appointFirstAdmin(db, admin.uid, "fixture");
    await createWorkspaceIndexes(db);
    await t.test(
      "archiving is owned, read-only and reversible; unfinished workflows must be cancelled",
      async () => {
        let workspace = await createWorkspace(
          db,
          owner,
          randomUUID(),
          "Archive controls",
        );
        await db.collection("workspaceWorkflows").insertOne({
          uid: owner.uid,
          workspaceId: workspace.id,
          status: "paused",
        });
        await assert.rejects(
          change(workspace, { action: "archive", archived: true }),
          /Finish or cancel/,
        );
        await db
          .collection("workspaceWorkflows")
          .updateMany(
            { workspaceId: workspace.id },
            { $set: { status: "cancelled" } },
          );
        await assert.rejects(
          commandWorkspace(db, { uid: "other", authTime: 1 }, workspace.id, {
            key: randomUUID(),
            revision: 0,
            expectedUid: "other",
            action: "archive",
            archived: true,
          }),
        );
        workspace = await change(workspace, {
          action: "archive",
          archived: true,
        });
        assert.ok(workspace.archivedAt);
        assert.equal(workspace.paused, true);
        for (const action of [
          { action: "message", text: "Should not persist" },
          { action: "pause", paused: false },
          { action: "upload", name: "x", base64: "invalid" },
        ])
          await assert.rejects(
            change(workspace, action),
            /Restore this archived/,
          );
        workspace = await change(workspace, {
          action: "archive",
          archived: false,
        });
        assert.equal(workspace.archivedAt, null);
        assert.equal(workspace.paused, true);
        workspace = await change(workspace, {
          action: "message",
          text: "Restored content",
        });
        assert.equal(
          (await workspaceView(db, workspace)).timeline.entries[0].parts[0]
            .type,
          "text",
        );
      },
    );
    await t.test(
      "restore or new unresolved evidence invalidates an exact preview",
      async () => {
        let workspace = await archived("Restore race");
        const report = await preview();
        assert.ok(report.ids.includes(`workspace:${workspace.id}`));
        workspace = await change(workspace, {
          action: "archive",
          archived: false,
        });
        const done = await executeCleanup(
          db,
          admin,
          report.id,
          "Test stale cleanup preview",
        );
        assert.equal(done.changed, 0);
        assert.equal(done.skipped, 1);
        assert.ok(await ownedWorkspace(db, owner.uid, workspace.id));
      },
    );
    await t.test(
      "active jobs, uncertain waivers, uploading objects and incomplete admission intents are excluded",
      async () => {
        const workspace = await archived("Unresolved evidence");
        const request = {
          capability: "workspace-compose",
          capabilityVersion: "1",
          binding: {
            name: "workspace-compose",
            revision: "1",
            kind: "workflow" as const,
            mode: "fake" as const,
            fingerprint: "fake",
          },
          inputs: { prompt: "private" },
          source: { type: "workspace", id: workspace.id, version: "1" },
          credits: 0,
        };
        const job = await createAiJob(db, owner, "lifecycle-job", request);
        assert.equal((await preview()).workspaces, 0);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "cancelled", terminationEvidence: "unverified" } },
        );
        assert.equal((await preview()).workspaces, 0);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { terminationEvidence: "not-dispatched" } },
        );
        const stageId = randomUUID();
        await assetStages(db).insertOne({
          _id: stageId,
          uid: owner.uid,
          workspaceId: workspace.id,
          assetId: randomUUID(),
          state: "uploading",
          object: { storeId: "fixture", key: "private/key" },
          bytes: 10,
          digest: "fixture",
          createdAt: old,
        });
        assert.equal((await preview()).workspaces, 0);
        await assetStages(db).updateOne(
          { _id: stageId },
          { $set: { state: "deleted" } },
        );
        await workspaces.updateOne(
          { _id: workspace.id },
          {
            $set: {
              batches: [
                {
                  id: randomUUID(),
                  intents: [true],
                  items: [{ jobId: "not-yet-admitted" }],
                },
              ] as never,
            },
          },
        );
        assert.equal((await preview()).workspaces, 0);
        await workspaces.updateOne(
          { _id: workspace.id },
          { $set: { batches: [] } },
        );
        const report = await preview();
        assert.equal(report.workspaces, 1);
        // A changed terminal state must also be caught at execution, not only preview.
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "needs-review" } },
        );
        assert.equal(
          (
            await executeCleanup(
              db,
              admin,
              report.id,
              "Recheck uncertain job state",
            )
          ).changed,
          0,
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          {
            $set: {
              status: "cancelled",
              terminationEvidence: "not-dispatched",
            },
          },
        );
        const approved = await preview();
        await executeCleanup(
          db,
          admin,
          approved.id,
          "Remove terminal archived fixture",
        );
        const retained = await aiJobs(db).findOne({ _id: job._id });
        assert.deepEqual(retained?.inputs, {});
        assert.equal(retained?.source, null);
        assert.equal(retained?.fingerprint, job.fingerprint);
        assert.equal(
          (await createAiJob(db, owner, "lifecycle-job", request))._id,
          job._id,
        );
      },
    );
    await t.test(
      "confirmed deletion erases snapshots/events/assets, queues owned objects and prevents resurrection",
      async () => {
        let workspace = await createWorkspace(
          db,
          owner,
          randomUUID(),
          "Private authored title",
        );
        workspace = await change(workspace, {
          action: "save",
          artifactId: null,
          title: "Private draft",
          body: "Private content",
          dependencies: [],
        });
        workspace = await change(workspace, {
          action: "message",
          text: "Private conversation",
        });
        const inline = assetRecord(
          randomUUID(),
          owner.uid,
          workspace.id,
          "private.txt",
          Buffer.from("private file"),
          "text/plain",
        );
        await db.collection("workspaceAssets").insertOne(inline as never);
        const object = {
          storeId: "fixture",
          key: `assets/${randomUUID()}`,
          versionId: "one",
        };
        const stageId = randomUUID();
        await assetStages(db).insertOne({
          _id: stageId,
          uid: owner.uid,
          workspaceId: workspace.id,
          assetId: randomUUID(),
          state: "attached",
          object,
          bytes: 10,
          digest: "retained-identity",
          createdAt: old,
        });
        await db
          .collection("creditLedger")
          .insertOne({ uid: owner.uid, evidence: "permanent" });
        await db.collection("workspaceWorkflows").insertOne({
          uid: owner.uid,
          workspaceId: workspace.id,
          status: "completed",
          prompt: "private workflow",
        });
        workspace = await change(workspace, {
          action: "archive",
          archived: true,
        });
        await workspaces.updateOne(
          { _id: workspace.id },
          { $set: { archivedAt: old.toISOString() } },
        );
        const operationsBefore = await db
          .collection("workspaceOperations")
          .countDocuments();
        const report = await preview();
        assert.equal(report.workspaces, 1);
        assert.equal(report.workspaceAssets, 1);
        assert.ok(report.workspaceEvents >= 3);
        assert.ok(
          await privateAssetStore(db, { mode: "mongo" }).get(
            owner.uid,
            inline._id,
          ),
        );
        await assert.rejects(
          executeCleanup(
            db,
            owner,
            report.id,
            "Member cannot delete via admin",
          ),
        );
        const result = await executeCleanup(
          db,
          admin,
          report.id,
          "Permanently remove archived fixture",
        );
        assert.equal(result.changed, 1);
        assert.equal(result.storagePending, 1);
        assert.deepEqual(
          await executeCleanup(
            db,
            admin,
            report.id,
            "Replay exact approved report",
          ),
          result,
        );
        await assert.rejects(
          ownedWorkspace(db, owner.uid, workspace.id),
          /not found/,
        );
        assert.equal(
          await privateAssetStore(db, { mode: "mongo" }).get(
            owner.uid,
            inline._id,
          ),
          null,
        );
        for (const collection of [
          "workspaceEvents",
          "workspaceAssets",
          "workspaceWorkflows",
        ])
          assert.equal(
            await db
              .collection(collection)
              .countDocuments({ workspaceId: workspace.id }),
            0,
          );
        assert.equal(
          await db.collection("workspaceOperations").countDocuments(),
          operationsBefore,
        );
        assert.equal(await db.collection("creditLedger").countDocuments(), 1);
        assert.equal(
          (await assetStages(db).findOne({ _id: stageId }))?.state,
          "deleting",
        );
        await assert.rejects(
          createWorkspace(db, owner, workspace.id, "Private authored title"),
          /deleted/,
        );
        await assert.rejects(
          createWorkspace(
            db,
            { uid: "other", authTime: 1 },
            workspace.id,
            "Another title",
          ),
          /deleted/,
        );
        const tombstone = await db
          .collection<{ _id: string }>("workspaceTombstones")
          .findOne({ _id: workspace.id });
        assert.ok(tombstone);
        assert.ok(!JSON.stringify(tombstone).includes("Private"));
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
