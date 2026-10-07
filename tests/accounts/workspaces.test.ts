import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import sharp from "sharp";
import {
  createWorkspace,
  commandWorkspace,
  ownedWorkspace,
  workspaceView,
  createWorkspaceIndexes,
} from "../../src/lib/server/workspaces/store";
import {
  mongoAssetStore,
  validatedImage,
} from "../../src/lib/server/workspaces/assets";
import {
  aiJobs,
  createAiIndexes,
  fingerprint,
} from "../../src/lib/server/ai/jobs";
import {
  createCreditIndexes,
  grantCredits,
} from "../../src/lib/server/store/credits";
import {
  capability,
  providerForJob,
} from "../../src/lib/server/ai/capabilities";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import {
  currentVersion,
  questionSchema,
  validAnswer,
  workspaceCommandSchema,
  workspaceSchema,
  type WorkspaceCommand,
} from "../../src/lib/contracts/workspace";

const actor = {
  uid: "workspace-owner",
  authTime: Math.floor(Date.now() / 1000),
};
type Payload<T> = T extends unknown
  ? Omit<T, "key" | "revision" | "expectedUid">
  : never;
type Action = Payload<WorkspaceCommand>;
test("typed generated questions reject malformed controls and unoffered answers", () => {
  const question = questionSchema.parse({
    kind: "multiple",
    title: "Choose",
    explanation: "",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
  assert.equal(validAnswer(question, ["a", "b"]), true);
  assert.equal(validAnswer(question, ["a", "a"]), false);
  assert.equal(validAnswer(question, ["admin-action"]), false);
  assert.equal(validAnswer(question, "a"), false);
  assert.equal(
    questionSchema.safeParse({
      ...question,
      options: [question.options[0], question.options[0]],
    }).success,
    false,
  );
  assert.equal(
    questionSchema.safeParse({ ...question, html: "<script>" }).success,
    false,
  );
});

test("creation workspaces: durable decisions, artifacts, owned assets and batch recovery", async (t) => {
  const previousMode = process.env.DIFY_MODE;
  process.env.DIFY_MODE = "fake";
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  await client.connect();
  let sequence = 0;
  async function fixture(credits = 30) {
    const db = client.db(`workspaces_${++sequence}`);
    await createWorkspaceIndexes(db);
    await createCreditIndexes(db);
    await createAiIndexes(db);
    if (credits)
      await grantCredits(db, actor.uid, "fixture", {
        amount: credits,
        source: "purchase",
        reference: "fixture",
      });
    const initial = await createWorkspace(db, actor, randomUUID(), "Workspace");
    async function command(action: Action) {
      const current = await ownedWorkspace(db, actor.uid, initial.id);
      const request = workspaceCommandSchema.parse({
        ...action,
        key: randomUUID(),
        revision: current.revision,
        expectedUid: actor.uid,
      });
      return commandWorkspace(db, actor, initial.id, request);
    }
    async function batch(
      prompt = "Write a draft",
      count = 1,
      extra: {
        capability?:
          "workspace-compose" | "workspace-review" | "workspace-image";
        targetId?: string;
        dependencies?: { artifactId: string; version: number }[];
      } = {},
    ) {
      return command({
        action: "batch",
        capability: extra.capability ?? "workspace-compose",
        prompt,
        count,
        targetId: extra.targetId ?? null,
        dependencies: extra.dependencies ?? [],
        pricingKey: fingerprint({ mode: "fixed", credits: 1 }),
      });
    }
    async function run() {
      while (
        await processOneAiJob(db, {
          provider: (job) => providerForJob(job, { mode: "fake" }),
          authorize: async () => true,
          validateOutput: (job, result) =>
            capability(job.capability).validOutput(result.outputs),
        })
      ) {
        /* drain local simulated jobs */
      }
    }
    return { db, initial, command, batch, run };
  }
  try {
    await t.test(
      "owner isolation, access fencing, stale edits and exact replay",
      async () => {
        const { db, initial } = await fixture();
        const request = workspaceCommandSchema.parse({
          key: randomUUID(),
          revision: 0,
          expectedUid: actor.uid,
          action: "save",
          artifactId: null,
          title: "Draft",
          body: "Content",
          dependencies: [],
        });
        await assert.rejects(
          commandWorkspace(db, { ...actor, uid: "other" }, initial.id, {
            ...request,
            expectedUid: "other",
          }),
          /not found/,
        );
        const results = await Promise.all([
          commandWorkspace(db, actor, initial.id, request),
          commandWorkspace(db, actor, initial.id, request),
        ]);
        assert.equal(results[0].artifacts.length, 1);
        assert.equal(results[1].revision, 1);
        await assert.rejects(
          commandWorkspace(db, actor, initial.id, {
            ...request,
            action: "save",
            artifactId: null,
            title: "Changed",
            body: "Content",
            dependencies: [],
          }),
          /different input/,
        );
        await assert.rejects(
          commandWorkspace(db, actor, initial.id, {
            ...request,
            key: randomUUID(),
          }),
          /changed/,
        );
        await db
          .collection("accountAccess")
          .updateOne({ _id: actor.uid } as never, {
            $set: { status: "suspended" },
          });
        await assert.rejects(
          commandWorkspace(db, actor, initial.id, request),
          /not accessible/,
        );
      },
    );
    await t.test(
      "generated questions persist answers and reopening preserves history",
      async () => {
        const { db, initial, command, batch, run } = await fixture();
        let workspace = await batch("Ask a question");
        await run();
        workspace = await command({
          action: "select",
          batchId: workspace.batches[0].id,
          index: 0,
        });
        const cardId = workspace.cards[0].id;
        await assert.rejects(
          command({ action: "answer", cardId, value: "invented" }),
          /offered answer/,
        );
        workspace = await command({
          action: "answer",
          cardId,
          value: "concise",
        });
        assert.equal(workspace.cards[0].answer, "concise");
        await assert.rejects(
          command({ action: "answer", cardId, value: "detailed" }),
          /active question/,
        );
        workspace = await command({ action: "reopen", cardId });
        assert.equal(workspace.cards[0].status, "superseded");
        assert.equal(workspace.cards[0].answer, "concise");
        assert.equal(workspace.cards[1].status, "active");
        assert.equal(
          workspaceSchema.safeParse(
            await workspaceView(
              db,
              await ownedWorkspace(db, actor.uid, initial.id),
            ),
          ).success,
          true,
        );
      },
    );
    await t.test(
      "partial admission resumes with one hold per candidate and one selection",
      async () => {
        const { db, command, batch, run } = await fixture(1);
        let workspace = await batch("Draft", 3);
        const batchId = workspace.batches[0].id;
        assert.equal(await aiJobs(db).countDocuments(), 1);
        assert.match(workspace.batches[0].items[1].error!, /credit/i);
        await command({ action: "admit", batchId });
        assert.equal(await aiJobs(db).countDocuments(), 1);
        await grantCredits(db, actor.uid, "top-up", {
          amount: 10,
          source: "purchase",
          reference: "top-up",
        });
        await command({ action: "admit", batchId });
        assert.equal(await aiJobs(db).countDocuments(), 3);
        assert.equal(
          await db.collection("creditReservations").countDocuments(),
          3,
        );
        await run();
        workspace = await command({ action: "select", batchId, index: 1 });
        assert.equal(workspace.artifacts.length, 1);
        assert.equal(workspace.batches[0].selected, 1);
        await assert.rejects(
          command({ action: "select", batchId, index: 0 }),
          /already been selected/,
        );
      },
    );
    await t.test(
      "pause blocks pending admission; resume retains frozen pricing and inputs",
      async () => {
        const { db, command, batch } = await fixture(0);
        const workspace = await batch();
        const batchId = workspace.batches[0].id;
        await command({ action: "pause", paused: true });
        await grantCredits(db, actor.uid, "top-up", {
          amount: 10,
          source: "purchase",
          reference: "top-up",
        });
        await assert.rejects(command({ action: "admit", batchId }), /Resume/);
        assert.equal(await aiJobs(db).countDocuments(), 0);
        await command({ action: "pause", paused: false });
        await command({ action: "admit", batchId });
        const job = await aiJobs(db).findOne({ uid: actor.uid });
        assert.deepEqual(job?.inputs, workspace.batches[0].requests[0].inputs);
      },
    );
    await t.test(
      "immutable versions and transitive approval invalidation",
      async () => {
        const { command } = await fixture();
        let workspace = await command({
          action: "save",
          artifactId: null,
          title: "Source",
          body: "One",
          dependencies: [],
        });
        const source = workspace.artifacts[0].id;
        await command({
          action: "approve",
          artifactId: source,
          version: 1,
          reason: "",
        });
        workspace = await command({
          action: "save",
          artifactId: null,
          title: "Dependent",
          body: "Two",
          dependencies: [{ artifactId: source, version: 1 }],
        });
        const child = workspace.artifacts[1].id;
        await command({
          action: "approve",
          artifactId: child,
          version: 1,
          reason: "",
        });
        workspace = await command({
          action: "save",
          artifactId: source,
          title: "Source",
          body: "Changed",
          dependencies: [],
        });
        assert.equal(workspace.artifacts[0].versions[0].body, "One");
        assert.equal(workspace.artifacts[1].approval, null);
        assert.equal(workspace.approvals.length, 2);
        await assert.rejects(
          command({
            action: "approve",
            artifactId: child,
            version: 1,
            reason: "",
          }),
          /source version changed/,
        );
        await assert.rejects(
          command({
            action: "save",
            artifactId: source,
            title: "Cycle",
            body: "Bad",
            dependencies: [{ artifactId: child, version: 1 }],
          }),
          /cycle/,
        );
      },
    );
    await t.test(
      "stale generated revisions cannot replace newer work",
      async () => {
        const { command, batch, run } = await fixture();
        let workspace = await command({
          action: "save",
          artifactId: null,
          title: "Draft",
          body: "One",
          dependencies: [],
        });
        const artifactId = workspace.artifacts[0].id;
        workspace = await batch("Revise", 1, { targetId: artifactId });
        const batchId = workspace.batches[0].id;
        await command({
          action: "save",
          artifactId,
          title: "Draft",
          body: "Two",
          dependencies: [],
        });
        await run();
        await assert.rejects(
          command({ action: "select", batchId, index: 0 }),
          /source version changed/,
        );
      },
    );
    await t.test("changed decisions make prior candidates stale", async () => {
      const { command, batch, run } = await fixture();
      let workspace = await batch("Ask a question");
      await run();
      workspace = await command({
        action: "select",
        batchId: workspace.batches[0].id,
        index: 0,
      });
      const cardId = workspace.cards[0].id;
      workspace = await batch();
      const batchId = workspace.batches[1].id;
      await command({ action: "answer", cardId, value: "concise" });
      await run();
      await assert.rejects(
        command({ action: "select", batchId, index: 0 }),
        /decisions changed/,
      );
    });
    await t.test(
      "AI revisions preserve source dependencies and decision changes clear approval",
      async () => {
        const { command, batch, run } = await fixture();
        let workspace = await batch("Ask a question");
        await run();
        workspace = await command({
          action: "select",
          batchId: workspace.batches[0].id,
          index: 0,
        });
        const cardId = workspace.cards[0].id;
        await command({ action: "answer", cardId, value: "concise" });
        workspace = await command({
          action: "save",
          artifactId: null,
          title: "Source",
          body: "Reference",
          dependencies: [],
        });
        const source = workspace.artifacts[0].id;
        await command({
          action: "approve",
          artifactId: source,
          version: 1,
          reason: "",
        });
        workspace = await command({
          action: "save",
          artifactId: null,
          title: "Derived",
          body: "Draft",
          dependencies: [{ artifactId: source, version: 1 }],
        });
        const target = workspace.artifacts[1].id;
        workspace = await batch("Revise this draft", 1, { targetId: target });
        await run();
        workspace = await command({
          action: "select",
          batchId: workspace.batches[1].id,
          index: 0,
        });
        assert.deepEqual(currentVersion(workspace.artifacts[1]).dependencies, [
          { artifactId: source, version: 1 },
        ]);
        await command({
          action: "approve",
          artifactId: target,
          version: 2,
          reason: "",
        });
        workspace = await command({ action: "reopen", cardId });
        assert.equal(workspace.artifacts[1].approval, null);
        assert.equal(workspace.artifacts[0].approval?.version, 1);
        await assert.rejects(
          command({
            action: "approve",
            artifactId: target,
            version: 2,
            reason: "",
          }),
          /decisions changed/,
        );
        assert.equal(workspace.approvals.length, 2);
      },
    );
    await t.test(
      "version-pinned quality review requires explicit blocking acceptance",
      async () => {
        const { db, command, batch, run } = await fixture();
        let workspace = await command({
          action: "save",
          artifactId: null,
          title: "Draft",
          body: "One",
          dependencies: [],
        });
        const artifactId = workspace.artifacts[0].id;
        workspace = await batch("Review", 1, {
          capability: "workspace-review",
          targetId: artifactId,
        });
        await run();
        const savedBatch = workspace.batches[0];
        await aiJobs(db).updateOne(
          { _id: savedBatch.items[0].jobId },
          {
            $set: {
              "execution.outputs": {
                summary: "Needs revision",
                issues: [{ severity: "blocking", message: "Check the claim" }],
              },
            },
          },
        );
        await command({ action: "select", batchId: savedBatch.id, index: 0 });
        await assert.rejects(
          command({ action: "approve", artifactId, version: 1, reason: "" }),
          /blocking review/,
        );
        workspace = await command({
          action: "approve",
          artifactId,
          version: 1,
          reason: "I verified the cited claim against the source.",
        });
        assert.equal(workspace.artifacts[0].approval?.version, 1);
        workspace = await command({
          action: "save",
          artifactId,
          title: "Draft",
          body: "Repaired",
          dependencies: [],
        });
        assert.equal(workspace.reviews[0].version, 1);
        assert.equal(workspace.artifacts[0].approval, null);
      },
    );
    await t.test(
      "image validation, private asset ownership, exports and exact upload replay",
      async () => {
        const { db, initial, command } = await fixture();
        const png = await sharp({
          create: { width: 2, height: 2, channels: 4, background: "red" },
        })
          .png()
          .toBuffer();
        await assert.rejects(
          validatedImage(Buffer.from("<svg/>").toString("base64")),
          /valid, single-frame/,
        );
        // The APNG animation chunk must be rejected even if a decoder would
        // otherwise accept its default still image (CRC validation is irrelevant).
        const animationChunk = Buffer.alloc(20);
        animationChunk.writeUInt32BE(8, 0);
        animationChunk.write("acTL", 4);
        animationChunk.writeUInt32BE(2, 8);
        await assert.rejects(
          validatedImage(
            Buffer.concat([
              png.subarray(0, 33),
              animationChunk,
              png.subarray(33),
            ]).toString("base64"),
          ),
          /single-frame/,
        );
        const request = workspaceCommandSchema.parse({
          key: randomUUID(),
          revision: 0,
          expectedUid: actor.uid,
          action: "upload",
          name: "image.png",
          base64: png.toString("base64"),
        });
        let workspace = await commandWorkspace(db, actor, initial.id, request);
        await commandWorkspace(db, actor, initial.id, request);
        assert.equal(
          await db.collection("workspaceAssets").countDocuments(),
          1,
        );
        const asset = workspace.assets[0];
        assert.equal(await mongoAssetStore(db).get("other", asset.id), null);
        assert.equal(
          (await mongoAssetStore(db).get(actor.uid, asset.id))?.mime,
          "image/png",
        );
        workspace = await command({
          action: "export",
          artifactId: workspace.artifacts[0].id,
          version: 1,
          format: "json",
        });
        const exported = await mongoAssetStore(db).get(
          actor.uid,
          workspace.assets[1].id,
        );
        assert.equal(
          JSON.parse(Buffer.from(exported!.base64, "base64").toString()).version
            .assetId,
          asset.id,
        );
        assert.equal(currentVersion(workspace.artifacts[0]).number, 1);
      },
    );
    await t.test(
      "image adapter settles only decodable results and imports an owned image",
      async () => {
        const { db, command, batch, run } = await fixture();
        let workspace = await batch("A small image", 1, {
          capability: "workspace-image",
        });
        await run();
        const job = await aiJobs(db).findOne({
          _id: workspace.batches[0].items[0].jobId,
        });
        assert.equal(job?.status, "succeeded");
        workspace = await command({
          action: "select",
          batchId: workspace.batches[0].id,
          index: 0,
        });
        assert.equal(workspace.assets.length, 1);
        assert.ok(currentVersion(workspace.artifacts[0]).assetId);
        assert.equal(
          await capability("workspace-image").validOutput({
            title: "Bad",
            png: Buffer.from("not an image").toString("base64"),
          }),
          false,
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
