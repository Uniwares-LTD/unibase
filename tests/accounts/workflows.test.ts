import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  startWorkflow,
  changeWorkflow,
  processOneWorkflow,
  workflowRuns,
  createWorkflowIndexes,
  listWorkflows,
  startRepair,
} from "../../src/lib/server/workspaces/workflows";
import {
  createWorkspace,
  createWorkspaceIndexes,
  ownedWorkspace,
  commandWorkspace,
} from "../../src/lib/server/workspaces/store";
import { workflowTemplates } from "../../src/lib/creation/workflows";
import {
  workspaceCommandSchema,
  type WorkspaceCommand,
} from "../../src/lib/contracts/workspace";
import type { WorkflowDefinition } from "../../src/lib/contracts/workflow";
import {
  createAiIndexes,
  aiJobs,
  fingerprint,
  createAiJob,
} from "../../src/lib/server/ai/jobs";
import {
  createCreditIndexes,
  grantCredits,
  readWallet,
} from "../../src/lib/server/store/credits";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import {
  capability,
  providerForJob,
  prepareAiInputs,
  materializeAiResult,
} from "../../src/lib/server/ai/capabilities";
type Payload<T> = T extends unknown
  ? Omit<T, "key" | "revision" | "expectedUid">
  : never;
const actor = {
  uid: "workflow-owner",
  authTime: Math.floor(Date.now() / 1000),
};
test("durable workflows schedule dependencies, recover commands and preserve human control", async (t) => {
  const previous = process.env.DIFY_MODE;
  process.env.DIFY_MODE = "fake";
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  await client.connect();
  let sequence = 0;
  async function fixture() {
    const db = client.db(`workflow_${++sequence}`);
    await createWorkspaceIndexes(db);
    await createWorkflowIndexes(db);
    await createAiIndexes(db);
    await createCreditIndexes(db);
    await grantCredits(db, actor.uid, "fixture", {
      amount: 100,
      source: "purchase",
      reference: "fixture",
    });
    const workspace = await createWorkspace(
      db,
      actor,
      randomUUID(),
      "Workflow fixture",
    );
    let clock = Date.now();
    const read = () => ownedWorkspace(db, actor.uid, workspace.id);
    async function command(action: Payload<WorkspaceCommand>) {
      const current = await read();
      return commandWorkspace(
        db,
        actor,
        workspace.id,
        workspaceCommandSchema.parse({
          ...action,
          key: randomUUID(),
          expectedUid: actor.uid,
          revision: current.revision,
        }),
      );
    }
    async function start(
      definition = workflowTemplates.get("draft-review", 1).definition,
      sources: { artifactId: string; version: number }[] = [],
    ) {
      const current = await read();
      const input = {
        key: randomUUID(),
        expectedUid: actor.uid,
        revision: current.revision,
        definition,
        prompt: "Write a clear guide.",
        sources,
        targetId: null,
        pricingKeys: {
          "workspace-compose": fingerprint({ mode: "fixed", credits: 1 }),
          "workspace-review": fingerprint({ mode: "fixed", credits: 1 }),
        },
        maximumCredits: definition.steps.reduce(
          (sum, step) => sum + (step.kind === "task" ? step.count : 0),
          0,
        ),
      };
      return {
        run: await startWorkflow(db, actor, workspace.id, input),
        input,
      };
    }
    async function tick(jobs = true) {
      clock += 3000;
      await processOneWorkflow(db, {
        authorize: async () => true,
        now: () => new Date(clock),
      });
      if (jobs)
        while (
          await processOneAiJob(db, {
            provider: (job) => providerForJob(job, { mode: "fake" }),
            authorize: async () => true,
            prepareInput: (job) => prepareAiInputs(db, job),
            validateOutput: (job, result) =>
              capability(job.capability).validOutput(result.outputs),
            materialize: (job, result, session) =>
              materializeAiResult(db, job, result, session),
          })
        ) {}
    }
    async function advance(count = 16, jobs = true) {
      for (let i = 0; i < count; i++) await tick(jobs);
    }
    async function action(
      id: string,
      action: "pause" | "resume" | "cancel" | "checkpoint",
      stepId?: string,
    ) {
      const run = (await workflowRuns(db).findOne({ _id: id }))!;
      return changeWorkflow(db, actor, workspace.id, id, {
        key: randomUUID(),
        expectedUid: actor.uid,
        revision: run.revision,
        action,
        stepId,
      });
    }
    return { db, workspace, read, command, start, tick, advance, action };
  }
  try {
    await t.test(
      "findings retain evidence, repair creates a reviewed version, and resolution requires human confirmation",
      async () => {
        const f = await fixture();
        await f.start();
        await f.advance();
        const original = await f.read();
        const issue = original.qualityIssues[0];
        assert.equal(issue.status, "open");
        assert.equal(issue.version, 1);
        await assert.rejects(
          f.command({
            action: "quality-issue",
            issueId: issue.id,
            resolution: "resolve",
            reason: "Verified the repair outcome.",
          }),
        );
        const input = {
          key: randomUUID(),
          expectedUid: actor.uid,
          revision: original.revision,
          artifactId: issue.artifactId,
          issueIds: [issue.id],
          instructions: "Keep the intended audience clear.",
          composeProfile: null,
          reviewProfile: null,
          composePricingKey: fingerprint({ mode: "fixed", credits: 1 }),
          reviewPricingKey: fingerprint({ mode: "fixed", credits: 1 }),
          maximumCredits: 2,
        };
        await assert.rejects(
          startRepair(f.db, { ...actor, uid: "other-owner" }, f.workspace.id, {
            ...input,
            expectedUid: "other-owner",
          }),
        );
        await assert.rejects(
          startRepair(f.db, actor, f.workspace.id, {
            ...input,
            maximumCredits: 0,
          }),
        );
        const run = await startRepair(f.db, actor, f.workspace.id, input);
        assert.deepEqual(run.repairIssueIds, [issue.id]);
        assert.equal(
          (await startRepair(f.db, actor, f.workspace.id, input)).id,
          run.id,
        );
        const after = await f.read();
        assert.deepEqual(after.qualityIssues[0].repairRunIds, [run.id]);
        await assert.rejects(
          startRepair(f.db, actor, f.workspace.id, {
            ...input,
            key: randomUUID(),
            revision: after.revision,
          }),
        );
        await f.advance(20);
        const repaired = await f.read();
        assert.equal(repaired.artifacts.length, 1);
        assert.equal(repaired.artifacts[0].versions.length, 2);
        assert.equal(repaired.reviews.at(-1)?.version, 2);
        assert.equal(repaired.qualityIssues[0].status, "open");
        assert.equal(
          repaired.qualityIssues[0].history.filter(
            (entry) => entry.action === "repair",
          ).length,
          1,
        );
        await f.command({
          action: "quality-issue",
          issueId: issue.id,
          resolution: "resolve",
          reason: "Verified the newer content addresses this finding.",
        });
        const resolved = (await f.read()).qualityIssues[0];
        assert.equal(resolved.status, "resolved");
        assert.equal(
          resolved.history.at(-1)?.reviewId,
          repaired.reviews.at(-1)?.id,
        );
        assert.equal(resolved.history.at(-1)?.version, 2);
        await f.command({
          action: "quality-issue",
          issueId: issue.id,
          resolution: "reopen",
          reason: "Reopened after checking the source again.",
        });
        assert.equal((await f.read()).qualityIssues[0].status, "open");
        await assert.rejects(
          f.command({
            action: "quality-issue",
            issueId: issue.id,
            resolution: "accept",
            reason: "Cannot accept an older version.",
          }),
        );
        assert.equal(await aiJobs(f.db).countDocuments(), 4);
        assert.equal((await readWallet(f.db, actor.uid)).balance, 96);
      },
    );
    await t.test(
      "repair limits persist across cancellation and exact retries",
      async () => {
        const f = await fixture();
        await f.start();
        await f.advance();
        const issue = (await f.read()).qualityIssues[0];
        for (let attempt = 0; attempt < 3; attempt++) {
          const input = {
            key: randomUUID(),
            expectedUid: actor.uid,
            revision: (await f.read()).revision,
            artifactId: issue.artifactId,
            issueIds: [issue.id],
            instructions: "",
            composeProfile: null,
            reviewProfile: null,
            composePricingKey: fingerprint({ mode: "fixed", credits: 1 }),
            reviewPricingKey: fingerprint({ mode: "fixed", credits: 1 }),
            maximumCredits: 2,
          };
          const run = await startRepair(f.db, actor, f.workspace.id, input);
          await f.action(run.id, "cancel");
          assert.equal(
            (await startRepair(f.db, actor, f.workspace.id, input)).id,
            run.id,
          );
        }
        assert.equal((await f.read()).qualityIssues[0].repairRunIds.length, 3);
        await assert.rejects(
          startRepair(f.db, actor, f.workspace.id, {
            key: randomUUID(),
            expectedUid: actor.uid,
            revision: (await f.read()).revision,
            artifactId: issue.artifactId,
            issueIds: [issue.id],
            instructions: "",
            composeProfile: null,
            reviewProfile: null,
            composePricingKey: fingerprint({ mode: "fixed", credits: 1 }),
            reviewPricingKey: fingerprint({ mode: "fixed", credits: 1 }),
            maximumCredits: 2,
          }),
        );
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
        assert.equal((await readWallet(f.db, actor.uid)).reserved, 0);
      },
    );
    await t.test(
      "draft and review settle once, then wait for explicit approved checkpoint",
      async () => {
        const f = await fixture();
        const { run, input } = await f.start();
        assert.equal(
          (await startWorkflow(f.db, actor, f.workspace.id, input)).id,
          run.id,
        );
        await assert.rejects(
          listWorkflows(f.db, "another-owner", f.workspace.id),
        );
        await f.advance();
        const saved = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.deepEqual(
          saved.steps.map((step) => step.status),
          ["completed", "completed", "awaiting-human"],
        );
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
        assert.equal((await readWallet(f.db, actor.uid)).balance, 98);
        const content = await f.read();
        assert.equal(content.artifacts[0].approval, null);
        assert.equal(content.reviews.length, 1);
        await assert.rejects(f.action(run.id, "checkpoint", "approval"));
        await f.command({
          action: "approve",
          artifactId: content.artifacts[0].id,
          version: 1,
          reason: "Reviewed the result and accepted its findings.",
        });
        await f.action(run.id, "checkpoint", "approval");
        await f.tick();
        assert.equal(
          (await workflowRuns(f.db).findOne({ _id: run.id }))?.status,
          "completed",
        );
        await f.advance(3);
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
      },
    );
    await t.test(
      "crash after applying a saved command replays without duplicate jobs or holds",
      async () => {
        const f = await fixture();
        const { run } = await f.start();
        await f.tick(false);
        const planned = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.ok(planned.steps[0].command);
        await workflowRuns(f.db).updateOne(
          { _id: run.id },
          { $set: { lease: "crashed-worker", leaseUntil: new Date(0) } },
        );
        await commandWorkspace(
          f.db,
          actor,
          f.workspace.id,
          planned.steps[0].command!,
          { durableIntent: { workflowId: run.id, lease: "crashed-worker" } },
        );
        assert.equal(await aiJobs(f.db).countDocuments(), 1);
        await f.tick(false);
        assert.equal(await aiJobs(f.db).countDocuments(), 1);
        assert.equal(
          await f.db.collection("creditReservations").countDocuments(),
          1,
        );
        await f.advance();
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
      },
    );
    await t.test(
      "pause prevents commands, cancellation fences pending work and late admission cannot dispatch",
      async () => {
        const f = await fixture();
        const { run } = await f.start();
        await f.tick(false);
        const pending = (await workflowRuns(f.db).findOne({ _id: run.id }))!
          .steps[0].command!;
        await f.action(run.id, "pause");
        await f.advance(3, false);
        assert.equal(await aiJobs(f.db).countDocuments(), 0);
        await assert.rejects(
          commandWorkspace(f.db, actor, f.workspace.id, pending, {
            durableIntent: { workflowId: run.id, lease: "old-worker" },
          }),
        );
        await f.action(run.id, "resume");
        await f.tick(false);
        const batch = (await f.read()).batches[0];
        assert.ok(batch.requests[0].source?.workflowRunId);
        await f.action(run.id, "cancel");
        const late = await createAiJob(
          f.db,
          actor,
          "late-admission",
          batch.requests[0],
        );
        await f.advance(2);
        assert.equal(
          (await aiJobs(f.db).findOne({ _id: late._id }))?.status,
          "cancelled",
        );
        assert.equal((await readWallet(f.db, actor.uid)).reserved, 0);
        assert.equal((await readWallet(f.db, actor.uid)).balance, 100);
      },
    );
    await t.test(
      "parallel roots can be admitted before either completes and source edits block stale steps",
      async () => {
        const f = await fixture();
        const { run } = await f.start(
          workflowTemplates.get("parallel-synthesis", 1).definition,
        );
        await f.advance(6, false);
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
        assert.equal((await f.read()).artifacts.length, 0);
        await f.advance();
        const saved = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.equal(saved.steps[2].status, "awaiting-human");
        assert.equal(saved.steps[3].batchId, null);
        const artifact = (await f.read()).artifacts[0];
        await f.command({
          action: "save",
          artifactId: artifact.id,
          title: "Edited",
          body: "New content",
          dependencies: [],
        });
        await assert.rejects(f.action(run.id, "checkpoint", "sources"));
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
      },
    );
    await t.test(
      "generated forms pause dependent work until a validated response is saved",
      async () => {
        const f = await fixture();
        const definition: WorkflowDefinition = {
          type: "form-then-draft",
          version: 1,
          title: "Collect preferences",
          steps: [
            {
              kind: "task",
              id: "preferences",
              title: "Preferences",
              dependsOn: [],
              capability: "workspace-compose",
              prompt: "Generate a form",
              count: 1,
              selection: "automatic",
              profile: null,
              target: { kind: "new" },
            },
            {
              kind: "task",
              id: "draft",
              title: "Draft",
              dependsOn: ["preferences"],
              capability: "workspace-compose",
              prompt: "Write a draft from saved decisions",
              count: 1,
              selection: "automatic",
              profile: null,
              target: { kind: "new" },
            },
          ],
        };
        const { run } = await f.start(definition);
        await f.advance();
        assert.equal(await aiJobs(f.db).countDocuments(), 1);
        const card = (await f.read()).uiCards[0];
        assert.equal(card.content.type, "form");
        await f.command({
          action: "respond-card",
          cardId: card.id,
          cardAction: "submit",
          value: { audience: "Beginners", length: 500 },
        });
        await f.tick(); // Save the completed form step.
        await f.tick(); // Save the dependent batch intent, before admission.
        await f.command({ action: "reopen-card", cardId: card.id });
        await f.tick();
        const blocked = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.equal(blocked.steps[1].status, "blocked");
        assert.match(blocked.steps[1].error!, /prerequisite decision/);
        assert.equal(await aiJobs(f.db).countDocuments(), 1);
        await f.command({
          action: "respond-card",
          cardId: (await f.read()).uiCards.find(
            (item) => item.replacesCardId === card.id,
          )!.id,
          cardAction: "submit",
          value: { audience: "Experts", length: 800 },
        });
        await f.action(run.id, "resume");
        await f.advance();
        assert.equal(
          (await workflowRuns(f.db).findOne({ _id: run.id }))?.status,
          "completed",
        );
        assert.equal((await f.read()).artifacts.length, 1);
        const draftJob = await aiJobs(f.db).findOne({
          uid: actor.uid,
          "source.workflowRunId": run.id,
          "inputs.prompt": /Write a draft/,
        });
        assert.match(String(draftJob?.inputs.context), /Experts/);
      },
    );
    await t.test(
      "checkpoint approval is checked again when a saved dependent intent is applied",
      async () => {
        const f = await fixture();
        const { run } = await f.start(
          workflowTemplates.get("parallel-synthesis", 1).definition,
        );
        await f.advance();
        for (const artifact of (await f.read()).artifacts)
          await f.command({
            action: "approve",
            artifactId: artifact.id,
            version: 1,
            reason: "Reviewed source.",
          });
        await f.action(run.id, "checkpoint", "sources");
        await f.tick(false);
        const workspace = await f.read();
        const card = workspace.uiCards.find(
          (item) => item.content.type === "review",
        )!;
        await f.command({
          action: "respond-card",
          cardId: card.id,
          cardAction: "request-revision",
          value: "Approval needs another look.",
        });
        await f.tick(false);
        const saved = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.equal(saved.steps[3].status, "blocked");
        assert.match(saved.steps[3].error!, /checkpoint approval changed/);
        assert.equal(await aiJobs(f.db).countDocuments(), 2);
        for (const artifact of (await f.read()).artifacts)
          await f.command({
            action: "approve",
            artifactId: artifact.id,
            version: 1,
            reason: "Confirmed the source again.",
          });
        await f.action(run.id, "resume");
        await f.advance();
        assert.equal(await aiJobs(f.db).countDocuments(), 3);
        assert.equal(
          (await workflowRuns(f.db).findOne({ _id: run.id }))?.steps[4].status,
          "awaiting-human",
        );
      },
    );
    await t.test(
      "a selected confirmed-failure retry can continue a multi-candidate step",
      async () => {
        const f = await fixture();
        const { run } = await f.start(
          workflowTemplates.get("compare-review", 1).definition,
        );
        await f.advance(4, false);
        const batch = (await f.read()).batches[0];
        await aiJobs(f.db).updateMany(
          { _id: { $in: batch.items.map((item) => item.jobId) } },
          { $set: { cancelRequested: true } },
        );
        await f.advance();
        assert.equal(
          (await workflowRuns(f.db).findOne({ _id: run.id }))?.steps[0].status,
          "blocked",
        );
        const retry = await f.command({
          action: "retry-candidate",
          batchId: batch.id,
          index: 1,
          pricingKey: fingerprint({ mode: "fixed", credits: 1 }),
        });
        const successor = retry.batches.at(-1)!;
        await f.tick();
        await f.command({ action: "select", batchId: successor.id, index: 0 });
        await f.action(run.id, "resume");
        await f.advance();
        const saved = (await workflowRuns(f.db).findOne({ _id: run.id }))!;
        assert.equal(saved.steps[0].batchId, successor.id);
        assert.equal(saved.steps[2].status, "awaiting-human");
        assert.equal((await readWallet(f.db, actor.uid)).balance, 98);
      },
    );
  } finally {
    await client.close();
    await repl.stop();
    if (previous === undefined) delete process.env.DIFY_MODE;
    else process.env.DIFY_MODE = previous;
  }
});
