import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { unzipSync, strFromU8 } from "fflate";
import {
  createWorkspace,
  commandWorkspace,
  ownedWorkspace,
  type Workspace,
} from "../../src/lib/server/workspaces/store";
import {
  startExport,
  cancelExport,
  exportJobs,
  processOneExport,
  createExportIndexes,
  listExports,
} from "../../src/lib/server/workspaces/export-jobs";
import { archiveRenderer } from "../../src/lib/server/workspaces/export-renderers";
import { privateAssetStore } from "../../src/lib/server/workspaces/asset-storage";
import { workspaceTransaction } from "../../src/lib/server/workspaces/transaction";
import {
  deletableWorkspace,
  deleteArchivedWorkspace,
} from "../../src/lib/server/workspaces/lifecycle";

test("durable exports preserve snapshots, recover leases and fence cancellation and cleanup", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("export_jobs");
  const actor = { uid: "owner", authTime: 1 };
  const authorize = async () => true;
  const mutate = (workspace: Workspace, input: Record<string, unknown>) =>
    commandWorkspace(db, actor, workspace.id, {
      key: randomUUID(),
      revision: workspace.revision,
      expectedUid: actor.uid,
      ...input,
    } as never);
  async function source() {
    let workspace = await createWorkspace(
      db,
      actor,
      randomUUID(),
      "Export fixture",
    );
    workspace = await mutate(workspace, {
      action: "save",
      artifactId: null,
      title: "Original",
      body: "Original saved content",
      dependencies: [],
    });
    return workspace;
  }
  const request = (workspace: Workspace) => ({
    key: randomUUID(),
    expectedUid: actor.uid,
    revision: workspace.revision,
    format: "zip",
    renderer: { type: "archive", version: 1 },
    sources: [{ artifactId: workspace.artifacts[0].id, version: 1 }],
  });
  try {
    await createExportIndexes(db);
    await t.test(
      "concurrent exact admission is one owned job, changed input conflicts and DTOs exclude content",
      async () => {
        const workspace = await source(),
          input = request(workspace);
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            startExport(db, actor, workspace.id, input),
          ),
        );
        assert.equal(new Set(results.map((item) => item.id)).size, 1);
        assert.equal(
          await exportJobs(db).countDocuments({ workspaceId: workspace.id }),
          1,
        );
        assert.equal("snapshot" in results[0], false);
        assert.equal("authTime" in results[0], false);
        await assert.rejects(
          startExport(db, actor, workspace.id, {
            ...input,
            sources: [{ ...input.sources[0], version: 2 }],
          }),
          /different input/,
        );
        await assert.rejects(
          startExport(db, { uid: "other", authTime: 1 }, workspace.id, {
            ...input,
            expectedUid: "other",
          }),
          /not found/,
        );
        await assert.rejects(
          listExports(db, "other", workspace.id),
          /not found/,
        );
        await assert.rejects(
          startExport(db, actor, workspace.id, {
            ...input,
            renderer: { type: "archive", version: 99 },
          }),
          /unavailable/,
        );
        await assert.rejects(
          startExport(db, actor, workspace.id, { ...input, format: "pdf" }),
          /format/,
        );
        await cancelExport(db, actor, workspace.id, results[0].id, {
          expectedUid: actor.uid,
          revision: 0,
        });
        assert.equal(await processOneExport(db, { authorize }), false);
      },
    );
    await t.test(
      "rendering publishes the old selected version after edits without AI or credits",
      async () => {
        let workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        workspace = await mutate(workspace, {
          action: "save",
          artifactId: workspace.artifacts[0].id,
          title: "Changed",
          body: "New content",
          dependencies: [],
        });
        assert.ok(await processOneExport(db, { authorize }));
        const saved = (await exportJobs(db).findOne({ _id: job.id }))!;
        assert.equal(saved.status, "succeeded");
        assert.equal(saved.progress, 100);
        const asset = await privateAssetStore(db).get(
          actor.uid,
          saved.assetId!,
        );
        assert.ok(asset);
        const zip = unzipSync(Buffer.from(asset.base64, "base64"));
        const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
        assert.equal(
          manifest.artifacts[0].version.body,
          "Original saved content",
        );
        assert.equal(await privateAssetStore(db).get("other", asset._id), null);
        assert.equal(await db.collection("aiJobs").countDocuments(), 0);
        assert.equal(
          await db.collection("creditReservations").countDocuments(),
          0,
        );
        assert.equal(await processOneExport(db, { authorize }), false);
        assert.equal(
          (await ownedWorkspace(db, actor.uid, workspace.id)).assets.length,
          1,
        );
      },
    );
    await t.test(
      "cancellation during rendering blocks publication and archive waits for acknowledgement",
      async () => {
        const workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        await assert.rejects(
          mutate(workspace, { action: "archive", archived: true }),
          /exports/,
        );
        await processOneExport(db, {
          authorize,
          renderer: () => ({
            ...archiveRenderer,
            render: async (context) => {
              const running = (await exportJobs(db).findOne({ _id: job.id }))!;
              await cancelExport(db, actor, workspace.id, job.id, {
                expectedUid: actor.uid,
                revision: running.revision,
              });
              await assert.rejects(
                mutate(workspace, { action: "archive", archived: true }),
                /workers/,
              );
              return archiveRenderer.render(context);
            },
          }),
        });
        const cancelled = (await exportJobs(db).findOne({ _id: job.id }))!;
        assert.equal(cancelled.status, "cancelled");
        assert.equal(cancelled.lease, null);
        assert.equal(cancelled.assetId, null);
        assert.equal(
          await db
            .collection("workspaceAssets")
            .countDocuments({ workspaceId: workspace.id }),
          0,
        );
        assert.ok(
          (await mutate(workspace, { action: "archive", archived: true }))
            .archivedAt,
        );
      },
    );
    await t.test(
      "a replacement worker can finish an expired lease; the old worker cannot publish",
      async () => {
        const workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        let release!: () => void, started!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const old = processOneExport(db, {
          authorize,
          renderer: () => ({
            ...archiveRenderer,
            render: async (context) => {
              started();
              await gate;
              return archiveRenderer.render(context);
            },
          }),
        });
        await ready;
        try {
          await exportJobs(db).updateOne(
            { _id: job.id },
            { $set: { leaseUntil: new Date(0) } },
          );
          assert.ok(await processOneExport(db, { authorize }));
        } finally {
          release();
          await old;
        }
        const finished = (await exportJobs(db).findOne({ _id: job.id }))!;
        assert.equal(finished.status, "succeeded");
        assert.equal(finished.attempts, 2);
        assert.equal(
          await db
            .collection("workspaceAssets")
            .countDocuments({ workspaceId: workspace.id }),
          1,
        );
      },
    );
    await t.test(
      "repeated crashes become terminal and revoked accounts never render",
      async () => {
        const workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        await exportJobs(db).updateOne(
          { _id: job.id },
          {
            $set: { status: "rendering", attempts: 3, leaseUntil: new Date(0) },
          },
        );
        assert.equal(await processOneExport(db, { authorize }), false);
        assert.equal(
          (await exportJobs(db).findOne({ _id: job.id }))?.status,
          "failed",
        );
        const next = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        await processOneExport(db, {
          authorize: async () => false,
          renderer: () => {
            throw new Error("Must not render");
          },
        });
        assert.equal(
          (await exportJobs(db).findOne({ _id: next.id }))?.status,
          "cancelled",
        );
      },
    );
    await t.test(
      "publication rollback retries without orphaning inline bytes or attaching twice",
      async () => {
        const workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        const base = privateAssetStore(db);
        let fail = true;
        const store = {
          ...base,
          put: async (...args: Parameters<typeof base.put>) => {
            await base.put(...args);
            if (fail) throw new Error("Controlled transaction interruption");
          },
        };
        await processOneExport(db, { authorize, store });
        assert.equal(
          (await exportJobs(db).findOne({ _id: job.id }))?.status,
          "queued",
        );
        assert.equal(
          await db
            .collection("workspaceAssets")
            .countDocuments({ workspaceId: workspace.id }),
          0,
        );
        assert.equal(
          (await ownedWorkspace(db, actor.uid, workspace.id)).assets.length,
          0,
        );
        fail = false;
        await exportJobs(db).updateOne(
          { _id: job.id },
          { $set: { nextAttemptAt: new Date(0) } },
        );
        await processOneExport(db, { authorize, store });
        assert.equal(
          (await exportJobs(db).findOne({ _id: job.id }))?.status,
          "succeeded",
        );
        assert.equal(
          (await ownedWorkspace(db, actor.uid, workspace.id)).assets.length,
          1,
        );
      },
    );
    await t.test(
      "account revocation after rendering prevents publishing the prepared result",
      async () => {
        const workspace = await source();
        const job = await startExport(
          db,
          actor,
          workspace.id,
          request(workspace),
        );
        let checks = 0;
        await processOneExport(db, { authorize: async () => ++checks === 1 });
        assert.equal(checks, 2);
        assert.equal(
          (await exportJobs(db).findOne({ _id: job.id }))?.status,
          "cancelled",
        );
        assert.equal(
          await db
            .collection("workspaceAssets")
            .countDocuments({ workspaceId: workspace.id }),
          0,
        );
      },
    );
    await t.test(
      "cleanup excludes unresolved exports and removes snapshots while retaining request evidence",
      async () => {
        let workspace = await source();
        const input = request(workspace);
        const job = await startExport(db, actor, workspace.id, input);
        const old = new Date(Date.now() - 40 * 86400000);
        workspace.archivedAt = old.toISOString();
        workspace.paused = true;
        assert.equal(
          await workspaceTransaction(db, actor, (session) =>
            deletableWorkspace(db, workspace, session, new Date()),
          ),
          false,
        );
        await cancelExport(db, actor, workspace.id, job.id, {
          expectedUid: actor.uid,
          revision: 0,
        });
        workspace = await mutate(workspace, {
          action: "archive",
          archived: true,
        });
        await db
          .collection<Workspace>("workspaces")
          .updateOne(
            { _id: workspace.id },
            { $set: { archivedAt: old.toISOString() } },
          );
        const count = await db
          .collection("workspaceExportOperations")
          .countDocuments();
        await workspaceTransaction(db, actor, (session) =>
          deleteArchivedWorkspace(
            db,
            workspace.id,
            workspace.revision,
            new Date(),
            session,
            new Date(),
          ),
        );
        assert.equal(
          await exportJobs(db).countDocuments({ workspaceId: workspace.id }),
          0,
        );
        assert.equal(
          await db.collection("workspaceExportOperations").countDocuments(),
          count,
        );
        await assert.rejects(
          startExport(db, actor, workspace.id, input),
          /not found/,
        );
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
