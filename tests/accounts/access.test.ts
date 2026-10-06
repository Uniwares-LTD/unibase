import { test } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  accountAccess,
  accessPermitsSession,
  appointFirstAdmin,
  changeAccess,
} from "../../src/lib/server/store/access";

test("admin access is immediate, audited, transactional and safe under competing removals", async () => {
  const mongo = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
  });
  const client = new MongoClient(mongo.getUri());
  try {
    const db = client.db("unitale_access_test");
    const member = await accountAccess(db, "new-member");
    assert.equal(member.role, "member");
    assert.equal(accessPermitsSession(member, 100), true);
    await appointFirstAdmin(db, "admin-a", "Operator fixture appointment");
    await assert.rejects(
      appointFirstAdmin(db, "admin-b", "Duplicate operator appointment"),
      { code: "ADMIN_EXISTS" },
    );
    await assert.rejects(
      changeAccess(
        db,
        "new-member",
        "admin-a",
        { role: "member", status: "active" },
        "Forged member change",
      ),
      { code: "FORBIDDEN" },
    );
    await assert.rejects(
      changeAccess(
        db,
        "admin-a",
        "admin-a",
        { role: "member", status: "active" },
        "Self demotion attempt",
      ),
      { code: "SELF_CHANGE_DENIED" },
    );
    await changeAccess(
      db,
      "admin-a",
      "admin-b",
      { role: "admin", status: "active" },
      "Second fixture admin",
    );
    const race = await Promise.allSettled([
      changeAccess(
        db,
        "admin-a",
        "admin-b",
        { role: "member", status: "active" },
        "Concurrent demotion one",
      ),
      changeAccess(
        db,
        "admin-b",
        "admin-a",
        { role: "member", status: "active" },
        "Concurrent demotion two",
      ),
    ]);
    assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      await db
        .collection("accountAccess")
        .countDocuments({ role: "admin", status: "active" }),
      1,
    );
    const admin =
      (await accountAccess(db, "admin-a")).role === "admin"
        ? "admin-a"
        : "admin-b";
    const removed = admin === "admin-a" ? "admin-b" : "admin-a";
    await assert.rejects(
      changeAccess(
        db,
        removed,
        "new-member",
        { role: "admin", status: "active" },
        "Stale admin cookie",
      ),
      { code: "FORBIDDEN" },
    );
    const suspended = await changeAccess(
      db,
      admin,
      "new-member",
      { role: "member", status: "suspended" },
      "Suspend fixture account",
    );
    assert.equal(accessPermitsSession(suspended, Date.now() / 1000), false);
    const restored = await changeAccess(
      db,
      admin,
      "new-member",
      { role: "member", status: "active" },
      "Restore fixture account",
    );
    assert.equal(accessPermitsSession(restored, restored.notBefore - 1), false);
    assert.equal(accessPermitsSession(restored, restored.notBefore), true);
    const auditCount = await db.collection("auditEvents").countDocuments();
    const authTime = Math.floor(Date.now() / 1000);
    await db
      .collection<{ _id: string }>("accountAccess")
      .updateOne({ _id: admin }, { $set: { notBefore: authTime + 1 } });
    await assert.rejects(
      changeAccess(
        db,
        admin,
        "rollback-member",
        { role: "admin", status: "active" },
        "Pre-suspension actor token",
        authTime,
      ),
      { code: "FORBIDDEN" },
    );
    await db
      .collection<{ _id: string }>("accountAccess")
      .updateOne({ _id: admin }, { $set: { notBefore: 0 } });
    await db.command({
      collMod: "auditEvents",
      validator: { requiredImpossibleField: true },
    });
    await assert.rejects(
      changeAccess(
        db,
        admin,
        "rollback-member",
        { role: "admin", status: "active" },
        "Fail the required audit",
      ),
    );
    assert.equal((await accountAccess(db, "rollback-member")).role, "member");
    assert.equal(
      await db.collection("auditEvents").countDocuments(),
      auditCount,
    );
  } finally {
    await client.close();
    await mongo.stop();
  }
});
