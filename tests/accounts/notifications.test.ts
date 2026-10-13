import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  enqueueNotification,
  processOneNotification,
  notificationPage,
  notificationText,
  saveNotificationPreferences,
  markNotificationsRead,
  notificationDestination,
  pruneNotifications,
} from "../../src/lib/server/notifications";
import { grantCredits } from "../../src/lib/server/store/credits";
test("notification intents roll back, deduplicate, recover leases and preserve owned preferences and retention", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("notifications");
  const session = client.startSession();
  try {
    await assert.rejects(
      grantCredits(
        db,
        "owner",
        "purchase-rollback",
        { amount: 10, source: "purchase", reference: "rollback" },
        {
          persist: async () => {
            throw new Error("rollback");
          },
        },
      ),
    );
    assert.equal(await db.collection("notificationOutbox").countDocuments(), 0);
    await grantCredits(db, "owner", "purchase", {
      amount: 10,
      source: "purchase",
      reference: "purchase",
    });
    await grantCredits(db, "owner", "purchase", {
      amount: 10,
      source: "purchase",
      reference: "purchase",
    });
    assert.equal(await db.collection("notificationOutbox").countDocuments(), 1);
    await db
      .collection("notificationOutbox")
      .updateMany({}, { $set: { lease: "interrupted", nextAt: new Date(0) } });
    await Promise.all([processOneNotification(db), processOneNotification(db)]);
    let page = await notificationPage(db, "owner");
    assert.equal(page.unread, 1);
    assert.equal(page.rows.length, 1);
    assert.equal((await notificationPage(db, "other")).unread, 0);
    await assert.rejects(
      notificationDestination(db, "other", page.rows[0].id),
      { code: "NOT_FOUND" },
    );
    assert.equal(
      await notificationDestination(db, "owner", page.rows[0].id),
      "/credits",
    );
    await markNotificationsRead(db, "other", [page.rows[0].id]);
    assert.equal((await notificationPage(db, "owner")).unread, 1);
    await markNotificationsRead(db, "owner");
    assert.equal((await notificationPage(db, "owner")).unread, 0);
    await saveNotificationPreferences(db, "owner", {
      runs: false,
      credits: true,
      account: true,
    });
    await session.withTransaction(() =>
      enqueueNotification(
        db,
        "owner",
        "decision",
        "run-decision",
        { runId: "a".repeat(64) },
        session,
      ),
    );
    await processOneNotification(db);
    assert.equal((await notificationPage(db, "owner")).rows.length, 1);
    await session.withTransaction(() =>
      enqueueNotification(
        db,
        "owner",
        "account",
        "account-access",
        { role: "admin", status: "active" },
        session,
      ),
    );
    await processOneNotification(db);
    page = await notificationPage(db, "owner");
    assert.equal(page.rows.length, 2);
    await db
      .collection("notifications")
      .updateMany({}, { $set: { expiresAt: new Date(0) } });
    await db
      .collection("notificationOutbox")
      .updateMany({}, { $set: { expiresAt: new Date(0) } });
    await pruneNotifications(db);
    assert.equal(await db.collection("notifications").countDocuments(), 0);
    await session.withTransaction(() =>
      enqueueNotification(
        db,
        "owner",
        "account",
        "account-access",
        { role: "admin", status: "active" },
        session,
      ),
    );
    assert.equal(await processOneNotification(db), false);
    assert.equal(
      await db
        .collection("notificationOutbox")
        .countDocuments({ uid: { $exists: true } }),
      0,
    );
  } finally {
    await session.endSession();
    await client.close();
    await repl.stop();
  }
});

test("notification text resolves at read time without changing stored template data", () => {
  const params = { status: "succeeded" as const };
  assert.match(notificationText("run-final", params, "en"), /finished/);
  assert.notEqual(
    notificationText("run-final", params, "en"),
    notificationText("run-final", params, "ar"),
  );
  assert.deepEqual(params, { status: "succeeded" });
});
