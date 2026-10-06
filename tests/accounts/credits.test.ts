import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  adjustCredits,
  createCreditIndexes,
  finishReservation,
  grantCredits,
  readWallet,
  reserveCredits,
  reversePurchase,
} from "../../src/lib/server/store/credits";
import {
  appointFirstAdmin,
  changeAccess,
} from "../../src/lib/server/store/access";
import type {
  CreditLot,
  LedgerEntry,
  Wallet,
} from "../../src/lib/server/store/credit-types";

const start = new Date("2030-01-01T00:00:00Z");
const time = (minutes: number) => ({
  now: new Date(start.getTime() + minutes * 60000),
});
const actor = (uid: string) => ({
  uid,
  authTime: Math.floor(Date.now() / 1000),
});
const purchased = (amount: number, reference: string) => ({
  amount,
  reference,
  source: "purchase" as const,
});

async function invariant(db: Db, uid: string) {
  const wallet = await db
    .collection<Wallet>("creditWallets")
    .findOne({ _id: uid });
  assert.ok(wallet);
  const ledger = await db
    .collection<LedgerEntry>("creditLedger")
    .find({ uid })
    .sort({ sequence: 1 })
    .toArray();
  const lots = await db
    .collection<CreditLot>("creditLots")
    .find({ uid })
    .toArray();
  assert.equal(
    ledger.reduce((sum, item) => sum + item.delta, 0),
    wallet.balance,
  );
  assert.equal(
    ledger.reduce((sum, item) => sum + item.reservedDelta, 0),
    wallet.reserved,
  );
  assert.equal(
    lots.reduce((sum, item) => sum + item.remaining, 0) - wallet.debt,
    wallet.balance,
  );
  assert.equal(
    lots.reduce((sum, item) => sum + item.reserved, 0),
    wallet.reserved,
  );
  assert.equal(wallet.sequence, ledger.length);
  assert.deepEqual(
    ledger.map((item) => item.sequence),
    ledger.map((_, i) => i + 1),
  );
  for (const lot of lots)
    assert.ok(lot.remaining >= lot.reserved && lot.reserved >= 0);
}

test("transactional credit accounting", async (t) => {
  const mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
  });
  const client = new MongoClient(mongo.getUri());
  const db = client.db("unitale_credits_test");
  try {
    await createCreditIndexes(db);
    await appointFirstAdmin(db, "admin", "Explicit synthetic administrator");

    await t.test(
      "zero by default; whole credits and perpetual purchases",
      async () => {
        assert.deepEqual(await readWallet(db, "zero", time(0)), {
          balance: 0,
          available: 0,
          reserved: 0,
          debt: 0,
        });
        assert.equal(
          await db.collection("creditLedger").countDocuments({ uid: "zero" }),
          0,
        );
        for (const amount of [
          -1,
          0,
          1.5,
          Infinity,
          Number.MAX_SAFE_INTEGER + 1,
        ])
          await assert.rejects(
            grantCredits(db, "zero", "invalid", purchased(amount, "invalid")),
            { code: "INVALID_CREDIT_INPUT" },
          );
        await assert.rejects(
          grantCredits(db, "zero", "expires", {
            ...purchased(1, "expires"),
            expiresAt: start,
          }),
          { code: "INVALID_CREDIT_INPUT" },
        );
        const grant = await grantCredits(
          db,
          "zero",
          "first",
          purchased(10, "first"),
          time(0),
        );
        const lot = await db
          .collection<CreditLot>("creditLots")
          .findOne({ _id: grant.lotId });
        assert.equal(lot?.expiresAt, null);
        assert.equal(
          (await readWallet(db, "zero", time(200000))).available,
          10,
        );
        await invariant(db, "zero");
      },
    );

    await t.test(
      "competing reservations cannot overspend and retries do not spend twice",
      async () => {
        const user = actor("race");
        await grantCredits(
          db,
          user.uid,
          "grant",
          purchased(100, "race"),
          time(0),
        );
        const results = await Promise.allSettled([
          reserveCredits(db, user, "reserve-one", 75, time(0)),
          reserveCredits(db, user, "reserve-two", 75, time(0)),
        ]);
        assert.equal(
          results.filter((item) => item.status === "fulfilled").length,
          1,
        );
        const success = results.find((item) => item.status === "fulfilled");
        assert.ok(
          success?.status === "fulfilled" && success.value.reservationId,
        );
        const failed = results.find((item) => item.status === "rejected");
        assert.ok(failed?.status === "rejected");
        assert.equal(failed.reason.code, "INSUFFICIENT_CREDITS");
        const id = success.value.reservationId;
        await assert.rejects(
          finishReservation(db, actor("other"), "steal", id, "commit", time(1)),
          { code: "RESERVATION_NOT_FOUND" },
        );
        const committed = await finishReservation(
          db,
          user,
          "commit",
          id,
          "commit",
          time(1),
        );
        assert.equal(committed.balance, 25);
        assert.deepEqual(
          await finishReservation(db, user, "commit", id, "commit", time(2)),
          committed,
        );
        assert.equal(
          (
            await finishReservation(
              db,
              user,
              "commit-other-key",
              id,
              "commit",
              time(2),
            )
          ).balance,
          25,
        );
        await assert.rejects(
          finishReservation(db, user, "release", id, "release", time(2)),
          { code: "RESERVATION_CLOSED" },
        );
        assert.equal(
          await db
            .collection("creditLedger")
            .countDocuments({ uid: user.uid, kind: "commit" }),
          1,
        );
        await invariant(db, user.uid);
      },
    );

    await t.test(
      "parallel duplicate grants and conflicting request keys",
      async () => {
        const grants = await Promise.all([
          grantCredits(
            db,
            "duplicates",
            "one",
            purchased(100, "duplicates"),
            time(0),
          ),
          grantCredits(
            db,
            "duplicates",
            "one",
            purchased(100, "duplicates"),
            time(0),
          ),
        ]);
        assert.deepEqual(grants[0], grants[1]);
        assert.equal(grants[0].balance, 100);
        await assert.rejects(
          grantCredits(
            db,
            "duplicates",
            "one",
            purchased(101, "duplicates"),
            time(1),
          ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await assert.rejects(
          grantCredits(
            db,
            "duplicates",
            "different",
            purchased(100, "duplicates"),
            time(1),
          ),
          { code: "PURCHASE_ALREADY_CREDITED" },
        );
        await assert.rejects(
          grantCredits(
            db,
            "another-owner",
            "different",
            purchased(100, "duplicates"),
            time(1),
          ),
          { code: "PURCHASE_ALREADY_CREDITED" },
        );
        await invariant(db, "duplicates");
      },
    );

    await t.test("grant expiry order and oldest perpetual order", async () => {
      const uid = "ordering";
      const later = await grantCredits(
        db,
        uid,
        "later",
        {
          amount: 20,
          source: "promotion",
          reference: "later",
          expiresAt: time(30).now,
        },
        time(0),
      );
      const perpetual = await grantCredits(
        db,
        uid,
        "perpetual",
        purchased(20, "ordering"),
        time(0),
      );
      const early = await grantCredits(
        db,
        uid,
        "early",
        {
          amount: 20,
          source: "promotion",
          reference: "early",
          expiresAt: time(20).now,
        },
        time(1),
      );
      await grantCredits(
        db,
        uid,
        "perpetual-two",
        purchased(20, "ordering-two"),
        time(2),
      );
      const hold = await reserveCredits(db, actor(uid), "reserve", 50, time(3));
      assert.ok(hold.reservationId);
      await finishReservation(
        db,
        actor(uid),
        "commit",
        hold.reservationId,
        "commit",
        time(4),
      );
      const remaining = async (id?: string) =>
        (await db.collection<CreditLot>("creditLots").findOne({ _id: id }))
          ?.remaining;
      assert.equal(await remaining(early.lotId), 0);
      assert.equal(await remaining(later.lotId), 0);
      assert.equal(await remaining(perpetual.lotId), 10);
      await invariant(db, uid);
    });

    await t.test(
      "valid hold can commit after grant expiry; release cannot resurrect expired funds",
      async () => {
        for (const mode of ["commit", "release"] as const) {
          const uid = `expiry-${mode}`;
          await grantCredits(
            db,
            uid,
            "grant",
            {
              amount: 100,
              source: "promotion",
              reference: uid,
              expiresAt: time(5).now,
            },
            time(0),
          );
          const hold = await reserveCredits(
            db,
            actor(uid),
            "reserve",
            60,
            time(1),
          );
          assert.ok(hold.reservationId);
          const afterExpiry = await readWallet(db, uid, time(6));
          assert.deepEqual(afterExpiry, {
            balance: 60,
            available: 0,
            reserved: 60,
            debt: 0,
          });
          const done = await finishReservation(
            db,
            actor(uid),
            "finish",
            hold.reservationId,
            mode,
            time(7),
          );
          assert.deepEqual(
            {
              balance: done.balance,
              available: done.available,
              reserved: done.reserved,
              debt: done.debt,
            },
            { balance: 0, available: 0, reserved: 0, debt: 0 },
          );
          await invariant(db, uid);
        }
        const uid = "hold-timeout";
        await grantCredits(
          db,
          uid,
          "grant",
          {
            amount: 40,
            source: "promotion",
            reference: uid,
            expiresAt: time(5).now,
          },
          time(0),
        );
        const hold = await reserveCredits(
          db,
          actor(uid),
          "reserve",
          40,
          time(0),
        );
        assert.ok(hold.reservationId);
        await assert.rejects(
          finishReservation(
            db,
            actor(uid),
            "late-commit",
            hold.reservationId,
            "commit",
            time(15),
          ),
          { code: "RESERVATION_CLOSED" },
        );
        assert.equal((await readWallet(db, uid, time(15))).available, 0);
        const released = await finishReservation(
          db,
          actor(uid),
          "release",
          hold.reservationId,
          "release",
          time(16),
        );
        assert.equal(released.status, "expired");
        assert.equal(
          await db
            .collection("creditLedger")
            .countDocuments({ uid, kind: "hold-expired" }),
          1,
        );
        await invariant(db, uid);
      },
    );

    await t.test(
      "promotional default, custom and perpetual expiry",
      async () => {
        const defaultGrant = await grantCredits(
          db,
          "defaults",
          "default",
          { amount: 10, source: "promotion", reference: "default" },
          time(0),
        );
        const perpetual = await grantCredits(
          db,
          "defaults",
          "perpetual",
          {
            amount: 10,
            source: "promotion",
            reference: "perpetual",
            expiresAt: null,
          },
          time(0),
        );
        const a = await db
          .collection<CreditLot>("creditLots")
          .findOne({ _id: defaultGrant.lotId });
        const b = await db
          .collection<CreditLot>("creditLots")
          .findOne({ _id: perpetual.lotId });
        assert.equal(a?.expiresAt?.getTime(), start.getTime() + 90 * 86400000);
        assert.equal(b?.expiresAt, null);
        assert.equal(
          (await readWallet(db, "defaults", time(90 * 1440))).balance,
          10,
        );
        await invariant(db, "defaults");
      },
    );

    await t.test(
      "reversal debt, cancelled holds, debt repayment and dispute restoration",
      async () => {
        const uid = "refund";
        const user = actor(uid);
        await grantCredits(db, uid, "paid", purchased(100, "refund"), time(0));
        const spend = await reserveCredits(db, user, "spend", 80, time(0));
        assert.ok(spend.reservationId);
        await finishReservation(
          db,
          user,
          "spend-done",
          spend.reservationId,
          "commit",
          time(1),
        );
        const pending = await reserveCredits(db, user, "pending", 10, time(1));
        assert.ok(pending.reservationId);
        const reversed = await reversePurchase(
          db,
          uid,
          "full-refund",
          "refund",
          100,
          time(2),
        );
        assert.deepEqual(
          {
            balance: reversed.balance,
            available: reversed.available,
            reserved: reversed.reserved,
            debt: reversed.debt,
          },
          { balance: -80, available: 0, reserved: 0, debt: 80 },
        );
        await assert.rejects(
          finishReservation(
            db,
            user,
            "cancelled",
            pending.reservationId,
            "commit",
            time(3),
          ),
          { code: "RESERVATION_CLOSED" },
        );
        await assert.rejects(
          reserveCredits(db, user, "overspend", 1, time(3)),
          { code: "CREDIT_DEBT" },
        );
        await assert.rejects(
          adjustCredits(
            db,
            actor("admin"),
            uid,
            "bad-deduction",
            { amount: 1, direction: "deduct", reason: "Cannot worsen debt" },
            time(3),
          ),
          { code: "CREDIT_DEBT" },
        );
        const repay = await grantCredits(
          db,
          uid,
          "new-paid",
          purchased(50, "refund-repay"),
          time(3),
        );
        assert.equal(repay.debt, 30);
        assert.equal(repay.available, 0);
        const restored = await reversePurchase(
          db,
          uid,
          "dispute-won",
          "refund",
          25,
          time(4),
        );
        assert.equal(restored.debt, 0);
        assert.equal(restored.available, 45);
        await reversePurchase(
          db,
          uid,
          "dispute-won-again",
          "refund",
          25,
          time(5),
        );
        assert.equal((await readWallet(db, uid, time(5))).balance, 45);
        assert.equal(
          await db
            .collection("creditLedger")
            .countDocuments({ uid, kind: "purchase-restoration" }),
          1,
        );
        await invariant(db, uid);
      },
    );

    await t.test(
      "unused credits cover reversals and unrelated holds stay valid",
      async () => {
        const uid = "unused-refund";
        await grantCredits(db, uid, "a", purchased(100, "unused-a"), time(0));
        await grantCredits(db, uid, "b", purchased(100, "unused-b"), time(1));
        const hold = await reserveCredits(db, actor(uid), "hold", 50, time(2));
        assert.ok(hold.reservationId);
        const refunded = await reversePurchase(
          db,
          uid,
          "refund-b",
          "unused-b",
          100,
          time(3),
        );
        assert.equal(refunded.reserved, 50);
        assert.equal(refunded.debt, 0);
        assert.equal(
          (
            await finishReservation(
              db,
              actor(uid),
              "commit",
              hold.reservationId,
              "commit",
              time(4),
            )
          ).balance,
          50,
        );
        await invariant(db, uid);
      },
    );

    await t.test(
      "fresh access and administrator permissions inside transactions",
      async () => {
        const uid = "suspended";
        const user = actor(uid);
        await grantCredits(
          db,
          uid,
          "grant",
          purchased(100, "suspended"),
          time(0),
        );
        await changeAccess(
          db,
          "admin",
          uid,
          { role: "member", status: "suspended" },
          "Suspend fixture wallet",
        );
        await assert.rejects(
          reserveCredits(db, user, "suspended-hold", 10, time(1)),
          { code: "FORBIDDEN" },
        );
        await changeAccess(
          db,
          "admin",
          uid,
          { role: "member", status: "active" },
          "Restore fixture wallet",
        );
        await assert.rejects(readWallet(db, uid, { ...time(2), actor: user }), {
          code: "FORBIDDEN",
        });
        await assert.rejects(
          adjustCredits(
            db,
            actor("member"),
            uid,
            "forged",
            { amount: 10, direction: "grant", reason: "Forged member grant" },
            time(2),
          ),
          { code: "FORBIDDEN" },
        );
        const fresh = { uid, authTime: user.authTime + 2 };
        assert.equal(
          (await reserveCredits(db, fresh, "fresh-hold", 10, time(2))).reserved,
          10,
        );
        await invariant(db, uid);
      },
    );

    await t.test(
      "failed required ledger and audit writes roll back money, lots, holds and request keys",
      async () => {
        const uid = "rollback";
        await grantCredits(
          db,
          uid,
          "grant",
          purchased(100, "rollback"),
          time(0),
        );
        const before = await readWallet(db, uid, time(0));
        await db.command({
          collMod: "creditLedger",
          validator: { requiredImpossibleField: true },
        });
        await assert.rejects(
          reserveCredits(db, actor(uid), "failed-hold", 50, time(1)),
        );
        assert.deepEqual(await readWallet(db, uid, time(1)), before);
        assert.equal(
          await db.collection("creditReservations").countDocuments({ uid }),
          0,
        );
        assert.equal(
          await db.collection("creditOperations").countDocuments({ uid }),
          1,
        );
        await db.command({ collMod: "creditLedger", validator: {} });
        const successful = await reserveCredits(
          db,
          actor(uid),
          "failed-hold",
          50,
          time(2),
        );
        assert.ok(successful.reservationId);
        await db.command({
          collMod: "creditLedger",
          validator: { requiredImpossibleField: true },
        });
        await assert.rejects(
          finishReservation(
            db,
            actor(uid),
            "failed-commit",
            successful.reservationId,
            "commit",
            time(3),
          ),
        );
        assert.equal((await readWallet(db, uid, time(3))).reserved, 50);
        await db.command({ collMod: "creditLedger", validator: {} });
        await finishReservation(
          db,
          actor(uid),
          "failed-commit",
          successful.reservationId,
          "commit",
          time(4),
        );
        const beforeAuditFailure = await readWallet(db, uid, time(4));
        await db.command({
          collMod: "auditEvents",
          validator: { requiredImpossibleField: true },
        });
        await assert.rejects(
          adjustCredits(
            db,
            actor("admin"),
            uid,
            "failed-adjustment",
            {
              amount: 20,
              direction: "grant",
              reason: "Fail mandatory admin audit",
            },
            time(5),
          ),
        );
        assert.deepEqual(
          await readWallet(db, uid, time(5)),
          beforeAuditFailure,
        );
        assert.equal(
          await db.collection("creditLots").countDocuments({ uid }),
          1,
        );
        assert.equal(
          await db.collection("creditOperations").countDocuments({ uid }),
          3,
        );
        await db.command({ collMod: "auditEvents", validator: {} });
        await adjustCredits(
          db,
          actor("admin"),
          uid,
          "failed-adjustment",
          {
            amount: 20,
            direction: "grant",
            reason: "Fail mandatory admin audit",
          },
          time(6),
        );
        assert.equal(
          await db
            .collection("auditEvents")
            .countDocuments({ event: "credit-adjustment", targetUid: uid }),
          1,
        );
        await invariant(db, uid);
      },
    );

    await t.test(
      "deductions cannot spend holds or create debt; numeric overflow rolls back",
      async () => {
        const uid = "deduct";
        await grantCredits(db, uid, "grant", purchased(100, "deduct"), time(0));
        await reserveCredits(db, actor(uid), "hold", 75, time(0));
        await assert.rejects(
          adjustCredits(
            db,
            actor("admin"),
            uid,
            "too-much",
            {
              amount: 26,
              direction: "deduct",
              reason: "Deduction exceeding availability",
            },
            time(1),
          ),
          { code: "INSUFFICIENT_CREDITS" },
        );
        const deducted = await adjustCredits(
          db,
          actor("admin"),
          uid,
          "allowed",
          {
            amount: 25,
            direction: "deduct",
            reason: "Deduct available fixture credits",
          },
          time(1),
        );
        assert.equal(deducted.balance, 75);
        assert.equal(deducted.debt, 0);
        await invariant(db, uid);
        await grantCredits(
          db,
          "overflow",
          "max",
          purchased(Number.MAX_SAFE_INTEGER, "overflow"),
          time(0),
        );
        await assert.rejects(
          grantCredits(
            db,
            "overflow",
            "overflow",
            purchased(1, "overflow-two"),
            time(1),
          ),
          { code: "INVALID_CREDIT_INPUT" },
        );
        assert.equal(
          await db.collection("creditLots").countDocuments({ uid: "overflow" }),
          1,
        );
        assert.equal(
          (await readWallet(db, "overflow", time(1))).balance,
          Number.MAX_SAFE_INTEGER,
        );
        await invariant(db, "overflow");
      },
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});
