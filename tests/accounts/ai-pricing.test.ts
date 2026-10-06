import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  createCreditIndexes,
  grantCredits,
  readWallet,
  finishManagedReservation,
} from "../../src/lib/server/store/credits";
import {
  aiJobs,
  createAiIndexes,
  createAiJob,
  settleAiJob,
  claimAiJob,
  persistAiEvent,
} from "../../src/lib/server/ai/jobs";
import {
  bindingSnapshot,
  providerForJob,
} from "../../src/lib/server/ai/capabilities";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import type { AiPricing } from "../../src/lib/config/ai-pricing";

test("variable AI settlement is atomic, capped, replay-safe and compatible with expired lots", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const now = new Date("2030-01-01T00:00:00Z");
  const actor = {
    uid: "pricing-owner",
    authTime: Math.floor(Date.now() / 1000),
  };
  let index = 0;
  const price: AiPricing = {
    mode: "tokens",
    maxCredits: 10,
    rate: { basis: "total", creditsPerMillion: "1000" },
  };
  async function fixture(pricing = price) {
    const db = client.db(`pricing_${++index}`);
    await createAiIndexes(db);
    await createCreditIndexes(db);
    await grantCredits(
      db,
      actor.uid,
      "seed",
      { amount: 100, source: "purchase", reference: "seed" },
      { now },
    );
    const job = await createAiJob(
      db,
      actor,
      "request",
      {
        capability: "assistant-text",
        capabilityVersion: "1",
        inputs: { prompt: "hello" },
        source: null,
        credits:
          pricing.mode === "fixed" ? pricing.credits : pricing.maxCredits,
        pricing,
        binding: bindingSnapshot("assistant-text", { mode: "fake" }),
      },
      now,
    );
    return { db, job };
  }
  const deps = {
    provider: (job: Parameters<typeof providerForJob>[0]) =>
      providerForJob(job, { mode: "fake" }),
    authorize: async () => true,
    validateOutput: () => true,
    now: () => now,
  };
  try {
    await t.test(
      "each mode settles its actual charge and returns unused credits",
      async () => {
        const cases: [AiPricing, number][] = [
          [price, 2],
          [
            {
              mode: "tokens",
              maxCredits: 10,
              rate: {
                basis: "split",
                inputCreditsPerMillion: "1000",
                outputCreditsPerMillion: "2000",
              },
            },
            2,
          ],
          [
            {
              mode: "provider-cost",
              maxCredits: 10,
              currency: "USD",
              creditsPerCurrencyUnit: "400",
            },
            1,
          ],
          [
            {
              mode: "hybrid",
              maxCredits: 10,
              baseCredits: 2,
              usage: {
                mode: "tokens",
                rate: { basis: "total", creditsPerMillion: "1000" },
              },
            },
            4,
          ],
          [
            {
              mode: "tokens",
              maxCredits: 3,
              rate: { basis: "total", creditsPerMillion: "1000000" },
            },
            3,
          ],
          [
            {
              mode: "tokens",
              maxCredits: 10,
              rate: { basis: "total", creditsPerMillion: "0" },
            },
            0,
          ],
        ];
        for (const [pricing, expected] of cases) {
          const { db, job } = await fixture(pricing);
          assert.equal(
            (await readWallet(db, actor.uid, { now })).reserved,
            job.credits,
          );
          await processOneAiJob(db, deps);
          const saved = await aiJobs(db).findOne({ _id: job._id });
          assert.equal(saved?.charge?.credits, expected);
          assert.deepEqual(saved?.pricing, pricing);
          assert.equal(
            (await readWallet(db, actor.uid, { now })).balance,
            100 - expected,
          );
          assert.equal((await readWallet(db, actor.uid, { now })).reserved, 0);
          await settleAiJob(db, saved!, "succeeded", now);
          assert.equal(
            await db
              .collection("creditLedger")
              .countDocuments({ kind: "commit" }),
            1,
          );
          await assert.rejects(
            finishManagedReservation(
              db,
              actor.uid,
              "conflicting-price",
              job.reservationId!,
              "commit",
              {
                managedJobId: job._id,
                chargeAmount: expected === 0 ? 1 : 0,
                now,
                persist: async () => {},
              },
            ),
          );
        }
      },
    );
    await t.test(
      "saved terms survive configuration changes and cancellation releases the maximum",
      async () => {
        const { db, job } = await fixture();
        const previous = process.env.AI_PRICING_JSON;
        try {
          process.env.AI_PRICING_JSON = JSON.stringify({
            "assistant-text": { mode: "fixed", credits: 99 },
          });
          await processOneAiJob(db, deps);
          assert.equal(
            (await aiJobs(db).findOne({ _id: job._id }))?.charge?.credits,
            2,
          );
        } finally {
          if (previous === undefined) delete process.env.AI_PRICING_JSON;
          else process.env.AI_PRICING_JSON = previous;
        }
        const cancelled = await fixture();
        const claimed = await claimAiJob(cancelled.db, now);
        assert.ok(claimed);
        await settleAiJob(cancelled.db, claimed, "cancelled", now);
        const wallet = await readWallet(cancelled.db, actor.uid, { now });
        assert.equal(wallet.balance, 100);
        assert.equal(wallet.reserved, 0);
        assert.equal(
          (await aiJobs(cancelled.db).findOne({ _id: cancelled.job._id }))
            ?.charge?.credits,
          0,
        );
      },
    );
    await t.test(
      "failed required materialization rolls back both charge and release",
      async () => {
        const { db, job } = await fixture();
        await assert.rejects(
          processOneAiJob(db, {
            ...deps,
            materialize: async () => {
              throw new Error("required write failed");
            },
          }),
          /required write failed/,
        );
        const wallet = await readWallet(db, actor.uid, { now });
        assert.equal(wallet.balance, 100);
        assert.equal(wallet.reserved, 10);
        assert.equal(
          (await aiJobs(db).findOne({ _id: job._id }))?.charge,
          undefined,
        );
        await processOneAiJob(db, {
          ...deps,
          now: () => new Date(now.getTime() + 240000),
        });
        assert.equal((await readWallet(db, actor.uid, { now })).balance, 98);
      },
    );
    await t.test(
      "missing monetary usage cannot be accepted or charged",
      async () => {
        const { db, job } = await fixture({
          mode: "provider-cost",
          maxCredits: 10,
          currency: "EUR",
          creditsPerCurrencyUnit: "400",
        });
        await processOneAiJob(db, deps);
        const saved = await aiJobs(db).findOne({ _id: job._id });
        assert.equal(saved?.status, "needs-review");
        assert.equal(saved?.failure, "usage-unavailable");
        assert.equal((await readWallet(db, actor.uid, { now })).reserved, 10);
        await assert.rejects(settleAiJob(db, saved!, "succeeded", now), {
          code: "AI_USAGE_MISSING",
        });
      },
    );
    await t.test(
      "unused expired promotional credits expire instead of becoming spendable",
      async () => {
        const { db } = await fixture({ mode: "fixed", credits: 0 });
        // Clear the free queued job before creating the paid reservation.
        await processOneAiJob(db, deps);
        await grantCredits(
          db,
          actor.uid,
          "promo",
          {
            amount: 5,
            source: "promotion",
            reference: "promo",
            expiresAt: new Date(now.getTime() + 60000),
          },
          { now },
        );
        const job = await createAiJob(
          db,
          actor,
          "expiry",
          {
            capability: "assistant-text",
            capabilityVersion: "1",
            inputs: { prompt: "hello" },
            source: null,
            credits: 10,
            pricing: price,
            binding: bindingSnapshot("assistant-text", { mode: "fake" }),
          },
          now,
        );
        const claimed = await claimAiJob(db, now);
        assert.ok(claimed);
        await providerForJob(job, { mode: "fake" }).start(
          { user: "unused", inputs: {} },
          (event) => persistAiEvent(db, claimed, event, now),
        );
        await settleAiJob(
          db,
          claimed,
          "succeeded",
          new Date(now.getTime() + 120000),
        );
        const wallet = await readWallet(db, actor.uid, {
          now: new Date(now.getTime() + 120000),
        });
        assert.equal(wallet.balance, 100);
        assert.equal(wallet.reserved, 0);
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
