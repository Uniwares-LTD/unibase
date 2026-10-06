import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { runtimeRecord } from "../../src/lib/log-policy";
import {
  createRuntimeIndexes,
  writeRuntimeRecord,
  type StoredRuntimeRecord,
} from "../../src/lib/server/store/runtime";
import { readReports, readDashboard } from "../../src/lib/server/store/reports";
import { appointFirstAdmin } from "../../src/lib/server/store/access";

test("admin reports retain sanitized runtime records and permanent audit with stable pagination", async () => {
  const mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
  });
  const client = new MongoClient(mongo.getUri());
  const db = client.db("unitale_reports_test");
  const actor = {
    uid: "reports-admin",
    authTime: Math.floor(Date.now() / 1000),
  };
  try {
    await appointFirstAdmin(db, actor.uid, "Explicit reports fixture admin");
    await createRuntimeIndexes(db);
    const reqId = randomUUID();
    await writeRuntimeRecord(
      db,
      runtimeRecord("request", {
        status: 401,
        requestId: reqId,
        message: "secret-body",
      }),
      500,
    );
    const stored = await db
      .collection("runtimeLogs")
      .findOne({ requestId: reqId });
    assert.ok(stored?.timestamp instanceof Date);
    assert.equal(JSON.stringify(stored).includes("secret"), false);
    const timestamps = new Date();
    for (let i = 0; i < 35; i++)
      await db.collection<StoredRuntimeRecord>("runtimeLogs").insertOne({
        _id: randomUUID(),
        timestamp: timestamps,
        event: "server-error",
        severity: "error",
        status: 500,
      });
    // Even during MongoDB's TTL sweep lag, reports exclude runtime records older
    // than 30 days. Permanent audit remains visible regardless of its age.
    const old = new Date(Date.now() - 31 * 86400000);
    await db.collection<StoredRuntimeRecord>("runtimeLogs").insertOne({
      _id: randomUUID(),
      timestamp: old,
      event: "server-error",
      severity: "error",
      status: 500,
    });
    const oldAuditId = randomUUID();
    await db.collection<Document & { _id: string }>("auditEvents").insertOne({
      _id: oldAuditId,
      event: "admin-profile-edit",
      actorUid: actor.uid,
      targetUid: "target",
      timestamp: old,
      reason: "Long-lived fixture reason",
      before: { displayName: "Before", secret: "must-not-serialize" },
      after: { displayName: "After" },
    });
    await assert.rejects(readReports(db, { ...actor, uid: "member" }, {}), {
      code: "FORBIDDEN",
    });
    const first = await readReports(db, actor, { severity: "error" });
    assert.equal(first.kind, "runtime");
    assert.equal(first.rows.length, 25);
    assert.ok(first.nextCursor);
    const second = await readReports(db, actor, {
      severity: "error",
      cursor: first.nextCursor,
    });
    assert.equal(second.rows.length, 10);
    assert.equal(second.nextCursor, null);
    const ids = [...first.rows, ...second.rows].map((row) => row.id);
    assert.equal(new Set(ids).size, 35);
    const match = await readReports(db, actor, {
      requestId: reqId.toUpperCase(),
      severity: "warn",
      event: "request",
    });
    assert.equal(match.rows.length, 1);
    assert.equal(
      (await readReports(db, actor, { event: "profile-save" })).rows.length,
      0,
    );
    const audit = await readReports(db, actor, {
      kind: "audit",
      targetUid: "target",
      actorUid: actor.uid,
    });
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].id, oldAuditId);
    assert.equal(JSON.stringify(audit).includes("must-not-serialize"), false);
    const sinceToday = await readReports(db, actor, {
      kind: "audit",
      from: new Date().toISOString().slice(0, 10),
    });
    assert.equal(
      sinceToday.rows.some((row) => row.id === oldAuditId),
      false,
    );
    const dayBefore = new Date(old.getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    const oldDay = old.toISOString().slice(0, 10);
    const oldWindow = await readReports(db, actor, {
      kind: "audit",
      from: dayBefore,
      to: oldDay,
      event: "admin-profile-edit",
    });
    assert.equal(oldWindow.rows.length, 1);
    for (const input of [
      { severity: "all" },
      { event: "secret-event" },
      { cursor: "secret-cursor" },
      { from: "2030-03-02", to: "2030-03-01" },
      { kind: "audit", requestId: reqId },
      { kind: "runtime", actorUid: "target" },
      { secret: "unknown-input" },
    ])
      await assert.rejects(readReports(db, actor, input), {
        code: "INVALID_REPORT_FILTER",
      });
    const indexes = await db.collection("runtimeLogs").indexes();
    assert.equal(
      indexes.find((index) => index.name === "runtime_retention_30_days")
        ?.expireAfterSeconds,
      30 * 86400,
    );
    assert.equal(
      (await db.collection("auditEvents").indexes()).some(
        (index) => "expireAfterSeconds" in index,
      ),
      false,
    );
    await db.collection("profiles").insertOne({ uid: "fixture-profile" });
    await db
      .collection<Document & { _id: string }>("accountAccess")
      .insertOne({ _id: "suspended", role: "member", status: "suspended" });
    const dashboard = await readDashboard(db, actor);
    assert.deepEqual(dashboard, {
      profiles: 1,
      admins: 1,
      suspended: 1,
      runtimeErrors: 35,
      auditedChanges: 1,
    });
    await db
      .collection<{ _id: string }>("accountAccess")
      .updateOne({ _id: actor.uid }, { $set: { role: "member" } });
    await assert.rejects(readReports(db, actor, {}), { code: "FORBIDDEN" });
  } finally {
    await client.close();
    await mongo.stop();
  }
});
