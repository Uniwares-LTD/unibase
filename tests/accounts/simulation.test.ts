import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  createSimulationOrder,
  simulatePurchase,
  createPurchaseIndexes,
  type SimulationOrder,
} from "../../src/lib/server/store/simulation";
import {
  createCreditIndexes,
  readCreditAccount,
  readWallet,
  grantCredits,
} from "../../src/lib/server/store/credits";
import { creditAccountSchema } from "../../src/lib/contracts/credits";

test("owned simulated purchases and wallet history", async (t) => {
  const mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
  });
  const client = new MongoClient(mongo.getUri());
  const db = client.db("unitale_simulation_test");
  const actor = {
    uid: "simulation-owner",
    authTime: Math.floor(Date.now() / 1000),
  };
  const pack = {
    id: "simulation-100",
    label: "100 simulated credits",
    credits: 100,
  };
  try {
    await createCreditIndexes(db);
    await createPurchaseIndexes(db);
    await t.test(
      "owned pending order, retries and immutable pack terms",
      async () => {
        const [a, b] = await Promise.all([
          createSimulationOrder(db, actor, "order", pack),
          createSimulationOrder(db, actor, "order", pack),
        ]);
        assert.equal(a, b);
        assert.equal(
          await db
            .collection("purchaseOrders")
            .countDocuments({ uid: actor.uid }),
          1,
        );
        assert.equal((await readWallet(db, actor.uid)).available, 0);
        await assert.rejects(
          createSimulationOrder(db, actor, "order", { ...pack, credits: 500 }),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await assert.rejects(
          simulatePurchase(db, { ...actor, uid: "other" }, a, "success"),
          { code: "ORDER_NOT_FOUND" },
        );
        await simulatePurchase(db, actor, a, "pending");
        assert.equal((await readWallet(db, actor.uid)).available, 0);
        await Promise.all([
          simulatePurchase(db, actor, a, "success"),
          simulatePurchase(db, actor, a, "success"),
        ]);
        await simulatePurchase(db, actor, a, "replay");
        assert.equal((await readWallet(db, actor.uid)).available, 100);
        assert.equal(
          await db
            .collection("creditLedger")
            .countDocuments({ uid: actor.uid, kind: "grant" }),
          1,
        );
        await simulatePurchase(db, actor, a, "refund");
        await simulatePurchase(db, actor, a, "refund");
        await simulatePurchase(db, actor, a, "replay");
        assert.equal((await readWallet(db, actor.uid)).available, 0);
        assert.equal(
          await db
            .collection("creditLedger")
            .countDocuments({ uid: actor.uid, kind: "purchase-reversal" }),
          1,
        );
        await assert.rejects(simulatePurchase(db, actor, a, "success"), {
          code: "ORDER_CLOSED",
        });
      },
    );
    await t.test(
      "failure and cancellation do not grant credits; terminal outcomes cannot be changed",
      async () => {
        for (const event of ["failure", "cancel"] as const) {
          const id = await createSimulationOrder(db, actor, event, pack);
          await simulatePurchase(db, actor, id, event);
          await simulatePurchase(db, actor, id, event);
          await assert.rejects(simulatePurchase(db, actor, id, "success"), {
            code: "ORDER_CLOSED",
          });
          assert.equal((await readWallet(db, actor.uid)).available, 0);
        }
      },
    );
    await t.test(
      "success and cancellation races produce one consistent outcome",
      async () => {
        const id = await createSimulationOrder(db, actor, "race", pack);
        const results = await Promise.allSettled([
          simulatePurchase(db, actor, id, "success"),
          simulatePurchase(db, actor, id, "cancel"),
        ]);
        assert.equal(
          results.filter((item) => item.status === "fulfilled").length,
          1,
        );
        const order = await db
          .collection<SimulationOrder>("purchaseOrders")
          .findOne({ _id: id });
        assert.equal(
          (await readWallet(db, actor.uid)).balance,
          order?.status === "paid" ? 100 : 0,
        );
        if (order?.status === "paid")
          await simulatePurchase(db, actor, id, "refund");
      },
    );
    await t.test(
      "required order-state failure rolls back the credit grant and retry succeeds once",
      async () => {
        const id = await createSimulationOrder(db, actor, "rollback", pack);
        await db.command({
          collMod: "purchaseOrders",
          validator: { requiredImpossibleField: true },
        });
        await assert.rejects(simulatePurchase(db, actor, id, "success"));
        assert.equal((await readWallet(db, actor.uid)).balance, 0);
        assert.equal(
          (
            await db
              .collection<SimulationOrder>("purchaseOrders")
              .findOne({ _id: id })
          )?.status,
          "pending",
        );
        await db.command({ collMod: "purchaseOrders", validator: {} });
        await simulatePurchase(db, actor, id, "success");
        assert.equal((await readWallet(db, actor.uid)).balance, 100);
        await simulatePurchase(db, actor, id, "refund");
      },
    );
    await t.test(
      "stable history pagination, projection boundary and upcoming expiry",
      async () => {
        const uid = "history-owner";
        for (let i = 0; i < 28; i++)
          await grantCredits(db, uid, `grant-${i}`, {
            amount: 1,
            source: "promotion",
            reference: `history-${i}`,
          });
        const account = await readCreditAccount(db, uid, undefined, {
          actor: { ...actor, uid },
        });
        assert.equal(account.history.length, 25);
        assert.equal(account.nextBefore, 4);
        assert.equal(account.upcoming.length, 10);
        assert.equal(account.available, 28);
        assert.equal(creditAccountSchema.safeParse(account).success, true);
        const older = await readCreditAccount(db, uid, account.nextBefore!);
        assert.deepEqual(
          older.history.map((item) => item.sequence),
          [3, 2, 1],
        );
        assert.equal(older.nextBefore, null);
        assert.ok(
          account.history.every(
            (item) =>
              !("uid" in item) &&
              !("operationId" in item) &&
              !("actorUid" in item),
          ),
        );
        const other = await readCreditAccount(db, "unfunded-other");
        assert.equal(other.history.length, 0);
        await assert.rejects(readCreditAccount(db, uid, 1.5), {
          code: "INVALID_CREDIT_INPUT",
        });
      },
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});
