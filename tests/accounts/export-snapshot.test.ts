import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  createWorkspace,
  commandWorkspace,
  type Workspace,
} from "../../src/lib/server/workspaces/store";
import { captureExportSnapshot } from "../../src/lib/server/workspaces/export-snapshot";
import { workspaceTransaction } from "../../src/lib/server/workspaces/transaction";
import { exportStartSchema } from "../../src/lib/contracts/export";
import { assetRecord } from "../../src/lib/server/workspaces/assets";

test("export snapshots pin owned versions, approval evidence and private byte identities", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("export_snapshots");
  const actor = { uid: "owner", authTime: 1 };
  const mutate = (workspace: Workspace, input: Record<string, unknown>) =>
    commandWorkspace(db, actor, workspace.id, {
      key: randomUUID(),
      revision: workspace.revision,
      expectedUid: actor.uid,
      ...input,
    } as never);
  try {
    let workspace = await createWorkspace(
      db,
      actor,
      randomUUID(),
      "Export source",
    );
    workspace = await mutate(workspace, {
      action: "save",
      artifactId: null,
      title: "Original",
      body: "Frozen content",
      dependencies: [],
    });
    const id = workspace.artifacts[0].id;
    workspace = await mutate(workspace, {
      action: "approve",
      artifactId: id,
      version: 1,
      reason: "Reviewed original",
    });
    const sources = [{ artifactId: id, version: 1 }];
    const snapshot = await workspaceTransaction(db, actor, (session) =>
      captureExportSnapshot(db, workspace, sources, session, new Date()),
    );
    workspace = await mutate(workspace, {
      action: "save",
      artifactId: id,
      title: "Later",
      body: "Changed content",
      dependencies: [],
    });
    assert.equal(snapshot.artifacts[0].version.body, "Frozen content");
    assert.equal(snapshot.artifacts[0].approval?.reason, "Reviewed original");
    assert.equal(workspace.artifacts[0].approval, null);
    assert.equal("uid" in snapshot.artifacts[0].approval!, false);
    await assert.rejects(
      workspaceTransaction(db, actor, (session) =>
        captureExportSnapshot(
          db,
          workspace,
          [{ artifactId: randomUUID(), version: 1 }],
          session,
          new Date(),
        ),
      ),
      /saved versions/,
    );

    const request = {
      key: randomUUID(),
      expectedUid: actor.uid,
      revision: workspace.revision,
      format: "zip",
      renderer: { type: "archive", version: 1 },
      sources,
    };
    assert.ok(exportStartSchema.safeParse(request).success);
    assert.equal(
      exportStartSchema.safeParse({
        ...request,
        sources: [...sources, ...sources],
      }).success,
      false,
    );
    assert.equal(
      exportStartSchema.safeParse({ ...request, template: "../../private" })
        .success,
      false,
    );

    const asset = assetRecord(
      randomUUID(),
      actor.uid,
      workspace.id,
      "owned.png",
      Buffer.from("fixture"),
      "image/png",
    );
    await db.collection("workspaceAssets").insertOne(asset as never);
    workspace.assets.push({
      id: asset._id,
      name: asset.name,
      mime: asset.mime,
      bytes: asset.bytes,
    });
    workspace.artifacts[0].versions[0].assetId = asset._id;
    delete workspace.artifacts[0].versions[0].content;
    const imageSnapshot = await workspaceTransaction(db, actor, (session) =>
      captureExportSnapshot(db, workspace, sources, session, new Date()),
    );
    assert.equal(imageSnapshot.assets[0].digest, asset.digest);
    assert.equal("base64" in imageSnapshot.assets[0], false);
    assert.equal("object" in imageSnapshot.assets[0], false);
    // A forged aggregate reference cannot make another owner's metadata exportable.
    await db
      .collection("workspaceAssets")
      .updateOne({ _id: asset._id as never }, { $set: { uid: "other" } });
    await assert.rejects(
      workspaceTransaction(db, actor, (session) =>
        captureExportSnapshot(db, workspace, sources, session, new Date()),
      ),
      /unavailable/,
    );
    await db
      .collection("workspaceAssets")
      .updateOne(
        { _id: asset._id as never },
        { $set: { uid: actor.uid, workspaceId: randomUUID() } },
      );
    await assert.rejects(
      workspaceTransaction(db, actor, (session) =>
        captureExportSnapshot(db, workspace, sources, session, new Date()),
      ),
      /unavailable/,
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
