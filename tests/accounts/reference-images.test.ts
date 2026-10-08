import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  createWorkspace,
  commandWorkspace,
  ownedWorkspace,
  createWorkspaceIndexes,
  type Workspace,
} from "../../src/lib/server/workspaces/store";
import {
  createCreditIndexes,
  grantCredits,
} from "../../src/lib/server/store/credits";
import {
  aiJobs,
  createAiIndexes,
  resolveAiJob,
  fingerprint,
} from "../../src/lib/server/ai/jobs";
import { aiFiles } from "../../src/lib/server/ai/files";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import {
  capability,
  providerForJob,
  materializeAiResult,
} from "../../src/lib/server/ai/capabilities";
import { prepareReferenceImages } from "../../src/lib/server/workspaces/reference-images";
import { appointFirstAdmin } from "../../src/lib/server/store/access";
import type { ProviderOutcome, Json } from "../../src/lib/server/ai/types";

test("owned image references: frozen edits, reusable uploads and uncertain preparation recovery", async (t) => {
  const previousMode = process.env.DIFY_MODE;
  process.env.DIFY_MODE = "fake";
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("references");
  const owner = { uid: "owner", authTime: 1 },
    admin = { uid: "admin", authTime: 1 };
  const price = fingerprint({ mode: "fixed", credits: 1 });
  let uploads = 0,
    dispatches = 0;
  let outcome: "ok" | "unknown" | "rejected" = "ok";
  const received: Record<string, Json>[] = [];
  let time = new Date();
  let preparationDelay = 0;
  async function upload(
    file: File,
    user: string,
  ): Promise<ProviderOutcome<{ id: string }>> {
    uploads++;
    assert.notEqual(user, owner.uid);
    assert.equal(file.type, "image/png");
    assert.equal(
      (await sharp(Buffer.from(await file.arrayBuffer())).metadata()).format,
      "png",
    );
    return outcome === "ok"
      ? { kind: "ok", value: { id: randomUUID() } }
      : ({ kind: outcome, failure: "invalid-response" } as ProviderOutcome<{
          id: string;
        }>);
  }
  async function work() {
    return processOneAiJob(db, {
      now: () => time,
      authorize: async () => true,
      provider: (job) => {
        const provider = providerForJob(job);
        return {
          ...provider,
          start: async (input, observe) => {
            dispatches++;
            received.push(input.inputs);
            const stored = await aiJobs(db).findOne({ _id: job._id });
            assert.ok(
              stored && stored.leaseUntil.getTime() - time.getTime() >= 179000,
            );
            return provider.start(input, observe);
          },
        };
      },
      prepareInput: async (job) => {
        const inputs = await prepareReferenceImages(
          db,
          job,
          job.inputs,
          upload,
        );
        time = new Date(time.getTime() + preparationDelay);
        return inputs;
      },
      validateOutput: (job, execution) =>
        capability(job.capability).validOutput(execution.outputs),
      materialize: (job, execution, session) =>
        materializeAiResult(db, job, execution, session),
    });
  }
  async function change(workspace: Workspace, action: Record<string, unknown>) {
    return commandWorkspace(db, owner, workspace.id, {
      key: randomUUID(),
      revision: workspace.revision,
      expectedUid: owner.uid,
      ...action,
    } as never);
  }
  async function picture(workspace: Workspace, color: string) {
    const png = await sharp({
      create: { width: 16, height: 16, channels: 4, background: color },
    })
      .png()
      .toBuffer();
    return change(workspace, {
      action: "upload",
      name: "Reference.png",
      base64: png.toString("base64"),
    });
  }
  try {
    await createCreditIndexes(db);
    await createAiIndexes(db);
    await createWorkspaceIndexes(db);
    await appointFirstAdmin(db, admin.uid, "fixture");
    await grantCredits(db, owner.uid, "grant", {
      amount: 50,
      source: "purchase",
      reference: "fixture",
    });
    let workspace = await picture(
      await createWorkspace(db, owner, randomUUID(), "Image references"),
      "red",
    );
    const originalAssetId = workspace.assets[0].id;
    const targetId = workspace.artifacts[0].id;
    await t.test(
      "foreign references and text targets are rejected before job admission",
      async () => {
        const other = await picture(
          await createWorkspace(db, owner, randomUUID(), "Other workspace"),
          "blue",
        );
        const action = {
          action: "batch",
          capability: "workspace-image",
          prompt: "Use references",
          count: 1,
          targetId: null,
          dependencies: [],
          pricingKey: price,
        };
        for (const refs of [
          [other.assets[0].id],
          [originalAssetId, originalAssetId],
        ])
          await assert.rejects(
            change(workspace, { ...action, referenceAssetIds: refs }),
          );
        workspace = await change(workspace, {
          action: "save",
          artifactId: null,
          title: "Text",
          body: "Text content",
          dependencies: [],
        });
        await assert.rejects(
          change(workspace, { ...action, targetId: workspace.artifacts[1].id }),
        );
        assert.equal(await aiJobs(db).countDocuments(), 0);
        assert.equal(uploads, 0);
      },
    );
    await t.test(
      "mixed candidates share a successful reference upload and edits create a new pinned version",
      async () => {
        workspace = await change(workspace, {
          action: "batch",
          capability: "workspace-image",
          prompt: "Edit the image",
          count: 2,
          targetId,
          referenceAssetIds: [originalAssetId],
          dependencies: [],
          pricingKey: price,
        });
        const batch = workspace.batches.at(-1)!;
        assert.equal(batch.requests[0].inputs.editAssetId, originalAssetId);
        assert.deepEqual(batch.requests[0].inputs.referenceAssetIds, [
          originalAssetId,
        ]);
        time = new Date(Date.now() + 1000);
        preparationDelay = 70000;
        assert.ok(await work());
        preparationDelay = 0;
        assert.ok(await work());
        assert.equal(uploads, 1);
        assert.equal(dispatches, 2);
        assert.equal(received[0].image_operation, "edit");
        assert.deepEqual(received[0].edit_image, received[0].reference_images);
        assert.equal(received[0].editAssetId, undefined);
        assert.equal(received[0].referenceUploadScope, undefined);
        workspace = await change(workspace, {
          action: "select",
          batchId: batch.id,
          index: 0,
        });
        assert.equal(workspace.artifacts[0].versions.length, 2);
        assert.equal(
          workspace.artifacts[0].versions[0].assetId,
          originalAssetId,
        );
        assert.notEqual(
          workspace.artifacts[0].versions[1].assetId,
          originalAssetId,
        );
      },
    );
    await t.test(
      "changing the target after generation prevents replacing the newer version",
      async () => {
        workspace = await change(workspace, {
          action: "batch",
          capability: "workspace-image",
          prompt: "Edit again",
          count: 1,
          targetId,
          dependencies: [],
          pricingKey: price,
        });
        const batchId = workspace.batches.at(-1)!.id;
        assert.ok(await work());
        workspace = await change(workspace, {
          action: "save-content",
          artifactId: targetId,
          content: {
            type: "image",
            version: 1,
            data: {
              title: "Changed target",
              assetId: originalAssetId,
              caption: "Human edit",
            },
          },
          dependencies: [],
        });
        await assert.rejects(
          change(workspace, { action: "select", batchId, index: 0 }),
          /changed/,
        );
      },
    );
    await t.test(
      "unknown reference upload blocks dispatch, is never resent, and needs explicit admin recovery before a new attempt",
      async () => {
        workspace = await picture(workspace, "green");
        const assetId = workspace.assets.at(-1)!.id;
        workspace = await change(workspace, {
          action: "batch",
          capability: "workspace-image",
          prompt: "Use green reference",
          count: 1,
          targetId: null,
          referenceAssetIds: [assetId],
          dependencies: [],
          pricingKey: price,
        });
        const batch = workspace.batches.at(-1)!;
        outcome = "unknown";
        const before = { uploads, dispatches };
        assert.ok(await work());
        let job = await aiJobs(db).findOne({ _id: batch.items[0].jobId });
        assert.equal(job?.status, "needs-review");
        assert.equal(job?.failure, "reference-upload-uncertain");
        assert.equal(job?.terminationEvidence, "not-dispatched");
        assert.equal(dispatches, before.dispatches);
        assert.equal(uploads, before.uploads + 1);
        await assert.rejects(
          prepareReferenceImages(db, job!, job!.inputs, upload),
        );
        assert.equal(uploads, before.uploads + 1);
        await assert.rejects(
          change(workspace, {
            action: "retry-candidate",
            batchId: batch.id,
            index: 0,
            pricingKey: price,
          }),
        );
        await resolveAiJob(
          db,
          admin,
          job!._id,
          "release",
          "Generation was never dispatched; review unresolved file separately",
          async () => false,
          time,
        );
        workspace = await ownedWorkspace(db, owner.uid, workspace.id);
        workspace = await change(workspace, {
          action: "retry-candidate",
          batchId: batch.id,
          index: 0,
          pricingKey: price,
        });
        assert.notEqual(
          workspace.batches.at(-1)!.requests[0].inputs.referenceUploadScope,
          batch.requests[0].inputs.referenceUploadScope,
        );
        outcome = "ok";
        assert.ok(await work());
        job = await aiJobs(db).findOne({
          _id: workspace.batches.at(-1)!.items[0].jobId,
        });
        assert.equal(job?.status, "succeeded");
        assert.equal(uploads, before.uploads + 2);
        assert.equal(
          await aiFiles(db).countDocuments({ status: "unknown" }),
          1,
        );
      },
    );
    await t.test(
      "confirmed file rejection releases generation credits without a provider generation call",
      async () => {
        workspace = await picture(workspace, "yellow");
        workspace = await change(workspace, {
          action: "batch",
          capability: "workspace-image",
          prompt: "Rejected reference",
          count: 1,
          targetId: null,
          referenceAssetIds: [workspace.assets.at(-1)!.id],
          dependencies: [],
          pricingKey: price,
        });
        const before = dispatches;
        outcome = "rejected";
        assert.ok(await work());
        const job = await aiJobs(db).findOne({
          _id: workspace.batches.at(-1)!.items[0].jobId,
        });
        assert.equal(job?.status, "failed");
        assert.equal(job?.terminationEvidence, "not-dispatched");
        assert.equal(dispatches, before);
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ managedJobId: job!._id })
          )?.status,
          "released",
        );
      },
    );
    await t.test(
      "exhausted file quota releases the generation hold without uploading or dispatching",
      async () => {
        const existing = await aiFiles(db).findOne({ uid: owner.uid });
        assert.ok(existing);
        await aiFiles(db).insertMany(
          Array.from({ length: 100 }, (_, index) => ({
            ...existing,
            _id: `quota-fixture-${index}`,
            sha256: `quota-fixture-${index}`,
          })),
        );
        workspace = await picture(workspace, "purple");
        workspace = await change(workspace, {
          action: "batch",
          capability: "workspace-image",
          prompt: "Reference at exhausted quota",
          count: 1,
          targetId: null,
          referenceAssetIds: [workspace.assets.at(-1)!.id],
          dependencies: [],
          pricingKey: price,
        });
        const before = { uploads, dispatches };
        outcome = "ok";
        assert.ok(await work());
        const job = await aiJobs(db).findOne({
          _id: workspace.batches.at(-1)!.items[0].jobId,
        });
        assert.equal(job?.status, "failed");
        assert.equal(job?.failure, "reference-upload-quota");
        assert.equal(job?.terminationEvidence, "not-dispatched");
        assert.deepEqual({ uploads, dispatches }, before);
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ managedJobId: job!._id })
          )?.status,
          "released",
        );
      },
    );
  } finally {
    if (previousMode === undefined) delete process.env.DIFY_MODE;
    else process.env.DIFY_MODE = previousMode;
    await client.close();
    await repl.stop();
  }
});
