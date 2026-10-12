import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  appointFirstAdmin,
  changeAccess,
} from "../../src/lib/server/store/access";
import {
  grantCredits,
  reserveCredits,
} from "../../src/lib/server/store/credits";
import { maintainCredits } from "../../src/lib/server/payment-worker";
import { createAiJob, aiJobs } from "../../src/lib/server/ai/jobs";
import { aiFiles } from "../../src/lib/server/ai/files";
import { aiHistory } from "../../src/lib/server/ai/history";
import {
  previewCleanup,
  executeCleanup,
} from "../../src/lib/server/store/cleanup";
import { reviewPaymentOrder } from "../../src/lib/server/store/payment-review";
import { createPaymentOrder } from "../../src/lib/server/store/payments";
import { healthyHeartbeat } from "../../src/lib/server/worker-heartbeat";

test("operations: maintenance, cleanup, ownership, history and manual payment review", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("operations");
  const admin = { uid: "admin", authTime: Math.floor(Date.now() / 1000) };
  try {
    await appointFirstAdmin(db, admin.uid, "fixture admin");
    await t.test(
      "managed hold cannot starve another user's expired ordinary hold",
      async () => {
        const old = Date.now() - 3600000;
        for (const [uid, offset, managedJobId] of [
          ["managed", 0, "job"],
          ["ordinary", 60000, undefined],
        ] as const) {
          const now = new Date(old + offset);
          await grantCredits(
            db,
            uid,
            "grant",
            { amount: 10, source: "purchase", reference: uid },
            { now },
          );
          await reserveCredits(db, { uid, authTime: 1 }, "reserve", 5, {
            now,
            ...(managedJobId ? { managedJobId, persist: async () => {} } : {}),
          });
        }
        await maintainCredits(db);
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ uid: "ordinary" })
          )?.status,
          "expired",
        );
        assert.equal(
          (
            await db
              .collection("creditReservations")
              .findOne({ uid: "managed" })
          )?.status,
          "active",
        );
        assert.equal(await maintainCredits(db), false);
      },
    );
    const old = new Date(Date.now() - 90 * 86400000);
    const owner = { uid: "owner", authTime: 1 };
    const request = {
      capability: "assistant-text",
      capabilityVersion: "1",
      binding: {
        name: "assistant-text",
        revision: "1",
        kind: "workflow" as const,
        mode: "fake" as const,
        fingerprint: "fake",
      },
      inputs: { prompt: "private prompt" },
      source: null,
      credits: 0,
    };
    const jobs: Awaited<ReturnType<typeof createAiJob>>[] = [];
    for (let n = 0; n < 28; n++) {
      const job = await createAiJob(db, owner, `job${n}`, request, old);
      await aiJobs(db).updateOne(
        { _id: job._id },
        {
          $set: {
            status: "succeeded",
            execution: {
              runId: "run",
              workflowId: null,
              status: "succeeded",
              outputs: { text: "private result" },
              usage: {
                scope: "execution",
                id: "run",
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                cost: null,
                elapsedMs: 1,
              },
            },
          },
        },
      );
      jobs.push(job);
    }
    await t.test(
      "history paginates timestamp ties and keeps ownership on every page",
      async () => {
        const first = await aiHistory(db, { uid: "owner" });
        assert.equal(first.rows.length, 25);
        assert.ok(first.next);
        const second = await aiHistory(db, { uid: "owner" }, first.next);
        assert.equal(second.rows.length, 3);
        assert.equal(
          new Set([...first.rows, ...second.rows].map((j) => j._id)).size,
          28,
        );
        assert.equal(
          (await aiHistory(db, { uid: "other" }, first.next)).rows.length,
          0,
        );
        await assert.rejects(aiHistory(db, { uid: "owner" }, "invalid"));
      },
    );
    await t.test(
      "preview does not mutate; execution preserves retry identity and skips changed or unresolved records",
      async () => {
        await aiJobs(db).updateOne(
          { _id: jobs[0]._id },
          { $set: { status: "needs-review" } },
        );
        await aiJobs(db).updateOne(
          { _id: jobs[1]._id },
          { $set: { status: "cancelled", execution: null } },
        );
        const preview = await previewCleanup(db, admin, {
          olderThanDays: 30,
          scope: "jobs",
          limit: 100,
        });
        assert.equal(preview.jobs, 26);
        assert.equal(
          await aiJobs(db).countDocuments({ cleanedAt: { $exists: true } }),
          0,
        );
        await aiJobs(db).updateOne(
          { _id: jobs[2]._id },
          { $set: { updatedAt: new Date() } },
        );
        const result = await executeCleanup(db, admin, preview.id, "");
        assert.equal(result.changed, 25);
        assert.equal(result.skipped, 1);
        assert.deepEqual(
          await executeCleanup(
            db,
            admin,
            preview.id,
            "Retry same approved batch",
          ),
          result,
        );
        assert.equal(
          await db
            .collection("auditEvents")
            .countDocuments({ event: "ai-cleanup" }),
          1,
        );
        const retained = await aiJobs(db).findOne({ _id: jobs[3]._id });
        assert.deepEqual(retained?.inputs, {});
        assert.equal(retained?.execution?.outputs, undefined);
        assert.equal(retained?.execution?.usage.totalTokens, 2);
        assert.equal(retained?.fingerprint, jobs[3].fingerprint);
        assert.equal(
          (await createAiJob(db, owner, "job3", request, old))._id,
          jobs[3]._id,
        );
        assert.equal(
          (await aiJobs(db).findOne({ _id: jobs[0]._id }))?.inputs.prompt,
          "private prompt",
        );
      },
    );
    await t.test(
      "cleanup is bounded, excludes unknown uploads and checks administrator access and preview expiry",
      async () => {
        for (const status of [
          "failed",
          "unknown",
          "ready",
          "uploading",
        ] as const)
          await aiFiles(db).insertOne({
            _id: status,
            uid: "owner",
            binding: request.binding,
            name: "private-name",
            mimeType: "text/plain",
            type: "document",
            bytes: 10,
            sha256: "hash",
            fingerprint: "retry",
            status,
            providerFileId: null,
            createdAt: old,
            updatedAt: old,
          });
        const preview = await previewCleanup(db, admin, {
          olderThanDays: 30,
          scope: "failed-files",
          limit: 1,
        });
        assert.equal(preview.files, 1);
        await assert.rejects(
          executeCleanup(
            db,
            { uid: "member", authTime: 1 },
            preview.id,
            "Unauthorized attempt",
          ),
        );
        await assert.rejects(
          executeCleanup(
            db,
            admin,
            preview.id,
            "Expired preview attempt",
            new Date(Date.now() + 960000),
          ),
        );
        await executeCleanup(
          db,
          admin,
          preview.id,
          "Reclaim failed upload quota",
        );
        assert.equal(
          (await aiFiles(db).findOne({ _id: "failed" }))?.name,
          "Removed",
        );
        assert.equal(
          (await aiFiles(db).findOne({ _id: "unknown" }))?.name,
          "private-name",
        );
        await assert.rejects(
          previewCleanup(db, admin, {
            olderThanDays: 0,
            scope: "jobs",
            limit: 101,
          }),
        );
      },
    );
    await t.test(
      "manual payment attempts are authorized, audited, replay-safe and report provider uncertainty",
      async () => {
        const order = await createPaymentOrder(
          db,
          owner,
          "order",
          {
            id: "pack",
            label: "Pack",
            credits: 10,
            stripePriceId: "price_test",
            amountMinor: 100,
            currency: "usd",
          },
          "https://example.test",
        );
        const input = {
          key: randomUUID(),
          orderId: order._id,
          reason: "Verify payment evidence",
        };
        let calls = 0;
        const reconcile = async () => {
          calls++;
        };
        await assert.rejects(
          reviewPaymentOrder(
            db,
            { uid: "member", authTime: 1 },
            input,
            reconcile,
          ),
        );
        assert.equal(calls, 0);
        assert.deepEqual(
          await reviewPaymentOrder(db, admin, input, reconcile),
          { state: "completed" },
        );
        await reviewPaymentOrder(db, admin, input, reconcile);
        assert.equal(calls, 1);
        await assert.rejects(
          reviewPaymentOrder(
            db,
            admin,
            { ...input, reason: "Changed request reason" },
            reconcile,
          ),
        );
        assert.deepEqual(
          await reviewPaymentOrder(
            db,
            admin,
            { ...input, key: randomUUID() },
            async () => {
              throw new Error("private provider failure");
            },
          ),
          { state: "needs-review" },
        );
        assert.equal(
          await db
            .collection("auditEvents")
            .countDocuments({ event: "payment-review" }),
          2,
        );
      },
    );
    await t.test(
      "demoted administrator cannot execute an existing cleanup preview",
      async () => {
        await changeAccess(
          db,
          "admin",
          "second-admin",
          { role: "admin", status: "active" },
          "fixture",
          admin.authTime,
        );
        const preview = await previewCleanup(db, admin, {
          olderThanDays: 30,
          scope: "jobs",
          limit: 5,
        });
        await changeAccess(
          db,
          "second-admin",
          "admin",
          { role: "member", status: "active" },
          "demote fixture",
          1,
        );
        await assert.rejects(
          executeCleanup(db, admin, preview.id, "No longer authorized"),
        );
      },
    );
    await t.test(
      "heartbeats reject failed, stale, future and malformed progress",
      () => {
        const now = Date.now();
        assert.ok(
          healthyHeartbeat({ state: "ok", updatedAt: new Date(now) }, now),
        );
        for (const [state, updatedAt] of [
          ["error", new Date(now)],
          ["ok", new Date(now - 300001)],
          ["ok", new Date(now + 1)],
          ["ok", new Date(NaN)],
        ] as const)
          assert.equal(healthyHeartbeat({ state, updatedAt }, now), false);
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
