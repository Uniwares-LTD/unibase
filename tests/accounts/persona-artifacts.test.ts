import assert from "node:assert/strict";
import { AppError } from "../../src/lib/auth-policy";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { parseAssetConfig } from "../../src/lib/config/assets";
import { s3ObjectStore } from "../../src/lib/server/runs/object-store";
import { processOneAssetDeletion } from "../../src/lib/server/runs/cleanup";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { readSettings } from "../../src/lib/server/settings";
import {
  aiJobs,
  claimAiJob,
  createAiJob,
  fingerprint,
  persistAiEvent,
  settleAiJob,
  resolveAiJob,
} from "../../src/lib/server/ai/jobs";
import { grantCredits, readWallet } from "../../src/lib/server/store/credits";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import { providerForRun } from "../../src/lib/server/runs/provider";
import {
  processOneAutomaticDecision,
  responderAnswer,
  responderCharges,
} from "../../src/lib/server/runs/responder";
import {
  authorizedRun,
  capabilityForRun,
} from "../../src/lib/server/runs/capabilities";
import {
  artifactOperation,
  processOneResultApplication,
  queueResultApplication,
} from "../../src/lib/server/runs/artifacts";
import {
  promoteAsset,
  releaseAssetReference,
  type ProductAsset,
} from "../../src/lib/server/runs/assets";
import {
  prepareResult,
  attachResult,
  readRunAsset,
} from "../../src/lib/server/runs/media";
import {
  previewCleanup,
  executeCleanup,
} from "../../src/lib/server/store/cleanup";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import type { Decision } from "../../src/lib/server/runs/service";
import {
  seedPersonas,
  personaChoices,
} from "../../src/lib/server/runs/personas";
import { appointFirstAdmin } from "../../src/lib/server/store/access";

test("Personas, private callbacks and product assets use durable owned boundaries", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("persona_artifacts");
  const old = { ...process.env };
  process.env.DIFY_MODE = "fake";
  process.env.ASSET_STORE = "mongo";
  process.env.DIFY_CREDENTIAL_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.MCP_ENABLED = "true";
  process.env.MCP_CLIENTS_JSON = JSON.stringify([
    {
      id: "dify",
      tokenEnv: "MCP_TOKEN_TEST",
      permissions: ["run:read", "artifact:read", "artifact:write"],
    },
  ]);
  process.env.MCP_TOKEN_TEST = "a".repeat(43);
  const usage = {
    id: "usage",
    scope: "execution" as const,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: null,
    elapsedMs: 1,
  };
  const actor = { uid: "owner", authTime: Math.floor(Date.now() / 1000) };
  const settings = (await readSettings(db)).settings;
  const definition = {
    id: "fixture",
    name: "Fixture",
    description: "",
    order: 0,
    keyEnv: "DIFY_KEY_FIXTURE",
    enabled: true,
    inputs: [],
    pricing: null,
    recovery: null,
  };
  const snapshot = {
    id: randomUUID(),
    name: "Parent",
    revision: 2,
    instructions: "Answer as a parent",
    responder: {
      ...definition,
      id: "responder",
      purpose: "responder" as const,
    },
    responderRevision: 1,
    pricing: { mode: "fixed" as const, credits: 1 },
    maxCalls: 2,
    maximum: 2,
  };
  async function parent(persona = true, artifactId?: string) {
    const key = randomUUID();
    const id = fingerprint([actor.uid, key]);
    return createAiJob(db, actor, key, {
      capability: "orchestrator",
      capabilityVersion: "1",
      inputs: { prompt: "decision" },
      binding: {
        name: definition.id,
        revision: "1",
        kind: "workflow",
        mode: "fake",
        fingerprint: "fixture",
      },
      source: null,
      credits: persona ? 3 : 1,
      pricing: { mode: "fixed", credits: 1 },
      run: {
        ...settings.runs,
        logicalId: id,
        attempt: 1,
        predecessorId: null,
        orchestrator: definition,
        configurationRevision: 1,
        settingsRevision: 0,
        answerer: persona ? snapshot : undefined,
        artifactId,
      },
    });
  }
  const worker = () =>
    processOneAiJob(db, {
      provider: (j) => providerForRun(j, db),
      authorize: async () => true,
      validateOutput: (j, result) => {
        try {
          if (j.responder) responderAnswer(j, result.outputs);
          return true;
        } catch {
          return false;
        }
      },
    });
  try {
    await grantCredits(db, actor.uid, "seed", {
      amount: 100,
      source: "purchase",
      reference: "seed",
    });
    await db
      .collection("runCapabilities")
      .createIndex({ jobId: 1 }, { unique: true });
    await t.test(
      "automatic question answering runs with no browser; submission and billing deduplicate",
      async () => {
        const job = await parent();
        await worker();
        assert.equal(
          (await aiJobs(db).findOne({ _id: job._id }))?.status,
          "paused",
        );
        assert.equal(
          await processOneAutomaticDecision(db, async () => true),
          true,
        );
        assert.equal(
          await processOneAutomaticDecision(db, async () => true),
          false,
        );
        assert.equal(
          await aiJobs(db).countDocuments({ "responder.parentId": job._id }),
          1,
        );
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        const decision = await db
          .collection<Decision>("runDecisions")
          .findOne({ jobId: job._id });
        assert.equal(decision?.status, "submitted");
        assert.equal(decision?.answerSource?.type, "persona");
        assert.equal(decision?.answerSource?.personaRevision, 2);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { nextAttemptAt: new Date(0) } },
        );
        await worker();
        const saved = (await aiJobs(db).findOne({ _id: job._id }))!;
        assert.equal(saved.status, "succeeded");
        assert.equal(saved.charge?.credits, 2);
        assert.equal(saved.responderCharge, 1);
        assert.equal(
          (await aiJobs(db).findOne({ "responder.parentId": job._id }))
            ?.responderFee,
          1,
        );
        assert.equal(await responderCharges(db, saved), 1);
      },
    );
    await t.test(
      "takeover prevents automatic submission but completed valid answers remain chargeable on parent failure",
      async () => {
        const job = await parent();
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        await worker();
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { "run.takenOver": true } },
        );
        await processOneAutomaticDecision(db, async () => true);
        assert.equal(
          (
            await db
              .collection<Decision>("runDecisions")
              .findOne({ jobId: job._id })
          )?.status,
          "pending",
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          {
            $set: {
              status: "running",
              execution: {
                runId: randomUUID(),
                workflowId: randomUUID(),
                status: "failed",
                outputs: null,
                usage,
              },
              nextAttemptAt: new Date(0),
            },
          },
        );
        const claimed = await claimAiJob(db);
        assert.equal(claimed?._id, job._id);
        await settleAiJob(db, claimed!, "failed", new Date());
        const saved = (await aiJobs(db).findOne({ _id: job._id }))!;
        assert.equal(saved.charge?.credits, 1);
        assert.equal(saved.parentCharge, 0);
      },
    );
    await t.test(
      "User mode is excluded; invalid responders, file questions and answer limits fall back without redispatch",
      async () => {
        const user = await parent(false);
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        assert.equal(
          await aiJobs(db).countDocuments({ "responder.parentId": user._id }),
          0,
        );
        assert.equal(
          (
            await db
              .collection<Decision>("runDecisions")
              .findOne({ jobId: user._id })
          )?.automaticError,
          undefined,
        );
        await aiJobs(db).updateOne(
          { _id: user._id },
          { $set: { status: "cancelled" } },
        );
        const job = await parent();
        await worker();
        await db.collection<Decision>("runDecisions").updateOne(
          { jobId: job._id },
          {
            $set: {
              form: {
                form_content: "Upload a photo",
                inputs: [{ type: "file", output_variable_name: "photo" }],
                user_actions: [{ id: "continue", title: "Continue" }],
                resolved_default_values: {},
              },
            },
          },
        );
        await processOneAutomaticDecision(db, async () => true);
        assert.equal(
          await aiJobs(db).countDocuments({ "responder.parentId": job._id }),
          0,
        );
        const d = await db
          .collection<Decision>("runDecisions")
          .findOne({ jobId: job._id });
        assert(d?.automaticError);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "cancelled" } },
        );
        const limited = await parent();
        await worker();
        await aiJobs(db).updateOne(
          { _id: limited._id },
          { $set: { "run.answerer.maxCalls": 1 } },
        );
        await processOneAutomaticDecision(db, async () => true);
        await worker();
        const first = (await db
          .collection<Decision>("runDecisions")
          .findOne({ jobId: limited._id }))!;
        const child = (await aiJobs(db).findOne({
          "responder.parentId": limited._id,
        }))!;
        assert.throws(() =>
          responderAnswer(child, {
            answer: JSON.stringify({ action: "unoffered", answers: {} }),
          }),
        );
        await db
          .collection<Decision>("runDecisions")
          .updateOne({ _id: first._id }, { $set: { status: "submitted" } });
        await db.collection<Decision>("runDecisions").insertOne({
          ...first,
          _id: fingerprint([first._id, "second"]),
          nodeId: "second",
          status: "pending",
          responderId: undefined,
          intent: undefined,
        });
        // BSON nulls are explicitly removed to represent a fresh decision.
        await db
          .collection<Decision>("runDecisions")
          .updateOne(
            { nodeId: "second", jobId: limited._id },
            { $unset: { responderId: "", intent: "" } },
          );
        await processOneAutomaticDecision(db, async () => true);
        assert.equal(
          await aiJobs(db).countDocuments({
            "responder.parentId": limited._id,
          }),
          1,
        );
        assert(
          (
            await db
              .collection<Decision>("runDecisions")
              .findOne({ nodeId: "second", jobId: limited._id })
          )?.automaticError,
        );
        await aiJobs(db).updateOne(
          { _id: limited._id },
          { $set: { status: "cancelled" } },
        );
        await seedPersonas(db);
        assert.equal((await personaChoices(db)).length, 0);
      },
    );
    await t.test(
      "responder dispatch requires active funding and a still-pending question",
      async () => {
        const job = await parent();
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        const child = (await aiJobs(db).findOne({
          "responder.parentId": job._id,
        }))!;
        await db
          .collection("creditReservations")
          .updateOne(
            { managedJobId: job._id },
            { $set: { status: "cancelled" } },
          );
        let dispatched = 0;
        await processOneAiJob(db, {
          provider: async (j) => {
            const provider = await providerForRun(j, db);
            return {
              ...provider,
              start: async (...args) => {
                dispatched++;
                return provider.start(...args);
              },
            };
          },
          authorize: async () => true,
          validateOutput: () => true,
        });
        assert.equal(dispatched, 0);
        assert.equal(
          (await aiJobs(db).findOne({ _id: child._id }))?.status,
          "cancelled",
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "cancelled" } },
        );
        const answered = await parent();
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        const unused = (await aiJobs(db).findOne({
          "responder.parentId": answered._id,
        }))!;
        await db
          .collection("runDecisions")
          .updateOne(
            { jobId: answered._id },
            { $set: { status: "submitted" } },
          );
        await processOneAiJob(db, {
          provider: async (j) => {
            const provider = await providerForRun(j, db);
            return {
              ...provider,
              start: async (...args) => {
                dispatched++;
                return provider.start(...args);
              },
            };
          },
          authorize: async () => true,
          validateOutput: () => true,
        });
        assert.equal(dispatched, 0);
        assert.equal(
          (await aiJobs(db).findOne({ _id: unused._id }))?.status,
          "cancelled",
        );
        await aiJobs(db).updateOne(
          { _id: answered._id },
          { $set: { status: "cancelled" } },
        );
      },
    );
    await t.test(
      "known private-context configuration failures never dispatch and release the hold",
      async () => {
        const job = await parent(false);
        let dispatched = 0;
        await processOneAiJob(db, {
          provider: async (j) => {
            const provider = await providerForRun(j, db);
            return {
              ...provider,
              start: async (...args) => {
                dispatched++;
                return provider.start(...args);
              },
            };
          },
          authorize: async () => true,
          prepareInput: async () => {
            throw new AppError(
              "CAPABILITY_CONFIGURATION",
              "Missing private context",
              503,
            );
          },
          validateOutput: () => true,
        });
        const saved = (await aiJobs(db).findOne({ _id: job._id }))!;
        assert.equal(dispatched, 0);
        assert.equal(saved.status, "failed");
        assert.equal(saved.terminationEvidence, "not-dispatched");
        assert.equal(saved.charge?.credits, 0);
      },
    );
    await t.test(
      "unknown responder dispatch and missing usage retain the combined hold",
      async () => {
        const job = await parent();
        await worker();
        await processOneAutomaticDecision(db, async () => true);
        const child = (await aiJobs(db).findOne({
          "responder.parentId": job._id,
        }))!;
        await aiJobs(db).updateOne(
          { _id: child._id },
          { $set: { status: "unknown", nextAttemptAt: new Date(0) } },
        );
        await worker();
        assert.equal(
          (await aiJobs(db).findOne({ _id: child._id }))?.status,
          "needs-review",
        );
        await assert.rejects(responderCharges(db, job), /reconciliation/);
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ managedJobId: job._id })
          )?.status,
          "active",
        );
        await aiJobs(db).updateOne(
          { _id: child._id },
          {
            $set: {
              status: "succeeded",
              execution: {
                runId: randomUUID(),
                workflowId: randomUUID(),
                status: "succeeded",
                outputs: { answer: "{}" },
                usage: {
                  ...usage,
                  inputTokens: null,
                  outputTokens: null,
                  totalTokens: null,
                },
              },
            },
          },
        );
        const priced = {
          ...job,
          run: {
            ...job.run!,
            answerer: {
              ...snapshot,
              pricing: {
                mode: "tokens" as const,
                maxCredits: 1,
                rate: { basis: "total" as const, creditsPerMillion: "1000" },
              },
            },
          },
        };
        await assert.rejects(responderCharges(db, priced), /billing usage/);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "cancelled" } },
        );
      },
    );
    await t.test(
      "missing responder price evidence is reviewable and an audited child waiver unblocks settlement",
      async () => {
        const job = await parent();
        await worker();
        await aiJobs(db).updateOne(
          { _id: job._id },
          {
            $set: {
              "run.answerer.pricing": {
                mode: "provider-cost",
                maxCredits: 1,
                currency: "USD",
                creditsPerCurrencyUnit: "100",
              },
            },
          },
        );
        await processOneAutomaticDecision(db, async () => true);
        await worker();
        const child = (await aiJobs(db).findOne({
          "responder.parentId": job._id,
        }))!;
        assert.equal(child.status, "needs-review");
        assert.equal(child.failure, "responder-usage-unavailable");
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ managedJobId: job._id })
          )?.status,
          "active",
        );
        await appointFirstAdmin(db, actor.uid, "Fixture billing administrator");
        await resolveAiJob(
          db,
          actor,
          child._id,
          "release",
          "Waive child with missing price evidence",
          () => true,
        );
        assert.equal(
          (await aiJobs(db).findOne({ _id: child._id }))?.status,
          "cancelled",
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          {
            $set: {
              nextAttemptAt: new Date(0),
              execution: {
                runId: randomUUID(),
                workflowId: randomUUID(),
                status: "failed",
                outputs: null,
                usage,
              },
            },
          },
        );
        const claim = await claimAiJob(db);
        assert.equal(claim?._id, job._id);
        await settleAiJob(db, claim!, "failed", new Date());
        assert.equal(
          (await aiJobs(db).findOne({ _id: job._id }))?.charge?.credits,
          0,
        );
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ managedJobId: job._id })
          )?.status,
          "released",
        );
      },
    );
    await t.test(
      "private capability has encrypted recovery, scope, expiry, revocation, idempotent saves and approval evidence",
      async () => {
        const artifactId = randomUUID();
        await db.collection("artifacts").insertOne({
          id: artifactId,
          uid: actor.uid,
          title: "Sample",
          revision: 0,
          approvedRevision: null,
          assets: [],
          createdAt: new Date(),
        });
        const job = await parent(false, artifactId);
        job.run!.orchestrator = {
          ...definition,
          contextInput: true,
          privateTools: [
            "read_artifact_v1",
            "save_artifact_draft_v1",
            "approve_artifact_v1",
          ],
        };
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { run: job.run, status: "running" } },
        );
        const token = await capabilityForRun(db, job);
        assert.equal(await capabilityForRun(db, job), token);
        const stored = await db
          .collection("runCapabilities")
          .findOne({ jobId: job._id });
        assert(!JSON.stringify(stored).includes(token));
        assert.equal(
          (
            await authorizedRun(
              db,
              token,
              "dify",
              "read_artifact_v1",
              undefined,
              async () => true,
            )
          ).uid,
          actor.uid,
        );
        await assert.rejects(
          authorizedRun(
            db,
            token,
            "other",
            "read_artifact_v1",
            undefined,
            async () => true,
          ),
        );
        await assert.rejects(
          authorizedRun(
            db,
            token,
            "dify",
            "get_run_context_v1",
            undefined,
            async () => true,
          ),
        );
        const payload = {
          operationKey: "draft",
          expectedRevision: 0,
          text: "An owned draft",
        };
        const signal = new AbortController().signal;
        const saved = await artifactOperation(
          db,
          token,
          "dify",
          "save_artifact_draft_v1",
          payload,
          signal,
          async () => true,
        );
        assert.deepEqual(
          await artifactOperation(
            db,
            token,
            "dify",
            "save_artifact_draft_v1",
            payload,
            signal,
            async () => true,
          ),
          saved,
        );
        await assert.rejects(
          artifactOperation(
            db,
            token,
            "dify",
            "save_artifact_draft_v1",
            { ...payload, text: "changed" },
            signal,
            async () => true,
          ),
        );
        const approval = {
          operationKey: "approve",
          revision: 1,
          contentHash: saved.contentHash,
        };
        await assert.rejects(
          artifactOperation(
            db,
            token,
            "dify",
            "approve_artifact_v1",
            approval,
            signal,
            async () => true,
          ),
        );
        await db.collection<Decision>("runDecisions").insertOne({
          _id: fingerprint([job._id, "approval"]),
          uid: actor.uid,
          jobId: job._id,
          logicalId: job.run!.logicalId,
          nodeId: "approve",
          title: "Approve",
          token: "opaque",
          createdAt: new Date(),
          status: "submitted",
          confirmedAction: "approve",
          answerSource: { type: "persona", personaRevision: 2 },
          approval: {
            artifactId,
            revision: 1,
            contentHash: saved.contentHash,
            action: "approve",
            requireHuman: true,
          },
        });
        await assert.rejects(
          artifactOperation(
            db,
            token,
            "dify",
            "approve_artifact_v1",
            approval,
            signal,
            async () => true,
          ),
        );
        await db
          .collection("runDecisions")
          .updateOne(
            { jobId: job._id },
            { $set: { "approval.requireHuman": false } },
          );
        await artifactOperation(
          db,
          token,
          "dify",
          "approve_artifact_v1",
          approval,
          signal,
          async () => true,
        );
        assert.equal(
          (await db.collection("artifacts").findOne({ id: artifactId }))
            ?.approvedRevision,
          1,
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { cancelRequested: true } },
        );
        await assert.rejects(
          authorizedRun(
            db,
            token,
            "dify",
            "read_artifact_v1",
            undefined,
            async () => true,
          ),
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "cancelled" } },
        );
      },
    );
    await t.test(
      "retained assets remain owned after Run cleanup and disappear after final reference removal",
      async () => {
        const job = await parent(false);
        const claim = await claimAiJob(db);
        assert.equal(claim?._id, job._id);
        const image =
          "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWPI7TtOU8QwakHfaBAdH01FuaMZ7fhoUZE7Wpr2jVY4uaNVZt9oq+L4aMOrb7TpeHxQt64Bo48Iagc7MYsAAAAASUVORK5CYII=";
        const execution = {
          runId: randomUUID(),
          workflowId: randomUUID(),
          status: "succeeded" as const,
          outputs: {
            result: {
              version: 1,
              outcome: "success",
              text: "Sample",
              cards: [],
              images: [{ id: randomUUID(), name: "Sample", base64: image }],
            },
          },
          usage,
        };
        await persistAiEvent(db, claim!, {
          type: "identity",
          runId: execution.runId,
          taskId: randomUUID(),
        });
        await persistAiEvent(db, claim!, { type: "execution", execution });
        await prepareResult(db, job, execution);
        await settleAiJob(db, claim!, "succeeded", new Date(), (session) =>
          attachResult(db, job, session),
        );
        const asset = await db
          .collection<ProductAsset>("runAssets")
          .findOne({ jobId: job._id });
        assert(asset);
        const session = client.startSession();
        try {
          await session.withTransaction(() =>
            promoteAsset(
              db,
              actor.uid,
              job._id,
              asset._id,
              "artifact:fixture",
              session,
            ),
          );
        } finally {
          await session.endSession();
        }
        await db.collection<{ _id: string }>("accountAccess").updateOne(
          { _id: actor.uid },
          {
            $set: {
              role: "admin",
              status: "active",
              notBefore: 0,
              revision: 0,
            },
          },
          { upsert: true },
        );
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { updatedAt: new Date(Date.now() - 40 * 86400000) } },
        );
        const preview = await previewCleanup(db, actor, {
          scope: "jobs",
          olderThanDays: 30,
          limit: 10,
        });
        await executeCleanup(
          db,
          actor,
          preview.id,
          "Verify retained asset cleanup",
        );
        assert.equal(
          await db
            .collection<ProductAsset>("runAssets")
            .countDocuments({ _id: asset._id }),
          0,
        );
        assert.equal(
          (await readRunAsset(db, actor.uid, asset._id)).bytes.length > 0,
          true,
        );
        await assert.rejects(readRunAsset(db, "other", asset._id));
        const release = client.startSession();
        try {
          await release.withTransaction(() =>
            releaseAssetReference(db, actor.uid, "artifact:fixture", release),
          );
        } finally {
          await release.endSession();
        }
        await assert.rejects(readRunAsset(db, actor.uid, asset._id));
      },
    );
    await t.test(
      "result application retries independently and template rejects context leakage",
      async () => {
        const artifactId = randomUUID();
        const job = await parent(false, artifactId);
        await aiJobs(db).updateOne(
          { _id: job._id },
          { $set: { status: "succeeded" } },
        );
        const session = client.startSession();
        try {
          await session.withTransaction(() =>
            queueResultApplication(db, job, session),
          );
        } finally {
          await session.endSession();
        }
        assert.equal(await processOneResultApplication(db), true);
        assert.equal(
          (
            await db
              .collection("resultApplications")
              .findOne({ jobId: job._id })
          )?.status,
          "failed",
        );
        await db.collection("artifacts").insertOne({
          id: artifactId,
          uid: actor.uid,
          title: "Retry",
          revision: 0,
          approvedRevision: null,
          assets: [],
          createdAt: new Date(),
        });
        await db
          .collection("resultApplications")
          .updateOne(
            { jobId: job._id },
            { $set: { status: "pending", nextAttemptAt: new Date() } },
          );
        await processOneResultApplication(db);
        assert.equal(
          (
            await db
              .collection("resultApplications")
              .findOne({ jobId: job._id })
          )?.status,
          "applied",
        );
        const graph =
          orchestratorTemplate("saved-artifact").build("fixture").workflow
            .graph;
        assert(inspectDifyWorkflow(graph).contextInput);
        graph.nodes.push({
          id: "leak",
          data: {
            type: "llm",
            title: "Leak",
            prompt_template: "{{#start.unibase_context#}}",
          },
        });
        assert.throws(() => inspectDifyWorkflow(graph));
      },
    );
    await t.test(
      "private S3 objects survive history cleanup; exact final deletion uses the maintenance worker",
      async () => {
        const objects = new Map<string, { bytes: Buffer; digest: string }>();
        const server = createServer(async (request, response) => {
          const path = new URL(request.url!, "http://localhost").pathname;
          if (request.method === "PUT") {
            const chunks = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            objects.set(path, {
              bytes: Buffer.concat(chunks),
              digest: String(request.headers["x-amz-meta-sha256"]),
            });
            response.setHeader("ETag", '"fixture"');
            response.end();
            return;
          }
          if (request.method === "DELETE") {
            objects.delete(path);
            response.statusCode = 204;
            response.end();
            return;
          }
          const object = objects.get(path);
          if (!object) {
            response.statusCode = 404;
            response.end();
            return;
          }
          response.setHeader("Content-Length", object.bytes.length);
          response.setHeader("x-amz-meta-sha256", object.digest);
          response.setHeader("Content-Type", "image/png");
          response.end(request.method === "HEAD" ? undefined : object.bytes);
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as { port: number }).port;
        Object.assign(process.env, {
          ASSET_STORE: "s3",
          ASSET_S3_ENDPOINT: `http://127.0.0.1:${port}`,
          ASSET_S3_REGION: "local",
          ASSET_S3_BUCKET: "fixture-bucket",
          ASSET_S3_PREFIX: "fixture",
          ASSET_S3_ACCESS_KEY_ID: "fixture",
          ASSET_S3_SECRET_ACCESS_KEY: "fixture",
          ASSET_S3_FORCE_PATH_STYLE: "true",
          APP_ENV: "local",
        });
        try {
          const config = parseAssetConfig(process.env);
          assert(config.mode === "s3");
          const store = s3ObjectStore(config);
          const id = randomUUID();
          const bytes = Buffer.from("owned fixture bytes");
          const digest = createHash("sha256").update(bytes).digest("hex");
          const object = await store.put(
            store.key(id),
            bytes,
            "image/png",
            digest,
          );
          const job = await parent(false);
          await aiJobs(db).updateOne(
            { _id: job._id },
            {
              $set: {
                status: "succeeded",
                updatedAt: new Date(Date.now() - 40 * 86400000),
                leaseUntil: new Date(0),
              },
            },
          );
          await db.collection<ProductAsset>("runAssets").insertOne({
            _id: id,
            uid: actor.uid,
            jobId: job._id,
            logicalId: job.run!.logicalId,
            name: "S3 fixture",
            mime: "image/png",
            bytes: bytes.length,
            digest,
            object,
            status: "ready",
            createdAt: new Date(),
            state: "ready",
            references: [],
            fence: 0,
          });
          const promotion = client.startSession();
          try {
            await promotion.withTransaction(() =>
              promoteAsset(
                db,
                actor.uid,
                job._id,
                id,
                "artifact:s3",
                promotion,
              ),
            );
          } finally {
            await promotion.endSession();
          }
          const preview = await previewCleanup(db, actor, {
            scope: "jobs",
            olderThanDays: 30,
            limit: 10,
          });
          await executeCleanup(
            db,
            actor,
            preview.id,
            "Verify S3 reference retention",
          );
          assert.deepEqual(
            (await readRunAsset(db, actor.uid, id)).bytes,
            bytes,
          );
          assert.equal(await processOneAssetDeletion(db), false);
          const release = client.startSession();
          try {
            await release.withTransaction(() =>
              releaseAssetReference(db, actor.uid, "artifact:s3", release),
            );
          } finally {
            await release.endSession();
          }
          assert.equal(await processOneAssetDeletion(db), true);
          assert.equal(objects.size, 0);
          assert.equal(
            (
              await db
                .collection<ProductAsset>("productAssets")
                .findOne({ _id: id })
            )?.state,
            "deleted",
          );
        } finally {
          process.env.ASSET_STORE = "mongo";
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      },
    );
    assert((await readWallet(db, actor.uid)).balance < 100);
  } finally {
    process.env = old;
    await client.close();
    await repl.stop();
  }
});
