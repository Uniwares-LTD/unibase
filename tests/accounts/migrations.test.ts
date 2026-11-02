import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  runMigrations,
  validateMigrations,
  type Migration,
} from "../../src/lib/server/migrations";

const step = (
  id: string,
  run: Migration["run"] = async (db: Db) =>
    db.collection("log").insertOne({ id }),
): Migration => ({
  id,
  description: id,
  run,
});

test("migration IDs are namespaced, unique and ordered per owner", () => {
  assert.doesNotThrow(() =>
    validateMigrations([
      step("core:0001-a"),
      step("notes:0001-a"),
      step("core:0002-b"),
    ]),
  );
  for (const ids of [
    ["bad"],
    ["core:1-a"],
    ["core:0001-a", "core:0001-a"],
    ["core:0002-b", "core:0001-a"],
  ])
    assert.throws(() => validateMigrations(ids.map((id) => step(id))));
  assert.throws(
    () => validateMigrations([step("run:0001-typo")], ["core", "runs"]),
    /unknown owner/,
  );
});

test("migrations apply once in order, skip disabled owners, retry failures and serialize runs", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("migrations");
  try {
    const log = async () =>
      (await db.collection("log").find().sort({ _id: 1 }).toArray()).map(
        (row) => row.id,
      );
    let fail = true;
    const flaky = step("core:0002-flaky", async (target) => {
      if (fail) throw new Error("synthetic failure");
      await target.collection("log").insertOne({ id: "core:0002-flaky" });
    });
    const list = [step("core:0001-first"), flaky, step("notes:0001-note")];

    // A failure stops the run, records nothing for it and releases the lock.
    await assert.rejects(
      runMigrations(db, list, (owner) => owner === "core"),
      /synthetic failure/,
    );
    assert.deepEqual(await log(), ["core:0001-first"]);
    assert.equal(await db.collection("control").countDocuments(), 0);

    fail = false;
    assert.deepEqual(
      await runMigrations(db, list, (owner) => owner === "core"),
      {
        applied: ["core:0002-flaky"],
        skipped: ["notes:0001-note"],
        changed: [],
      },
    );
    // Enabling the owner later applies its pending migration.
    assert.deepEqual((await runMigrations(db, list, () => true)).applied, [
      "notes:0001-note",
    ]);
    assert.deepEqual(await log(), [
      "core:0001-first",
      "core:0002-flaky",
      "notes:0001-note",
    ]);

    // Changed bodies are reported but never rerun.
    const changed = [
      step("core:0001-first", async () => {
        throw new Error("must not run");
      }),
      ...list.slice(1),
    ];
    assert.deepEqual((await runMigrations(db, changed, () => true)).changed, [
      "core:0001-first",
    ]);

    // A live lease blocks a second runner; an expired one is taken over.
    await db.collection<{ _id: string }>("control").insertOne({
      _id: "migrations-lock",
      owner: "other",
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    await assert.rejects(
      runMigrations(db, list, () => true),
      /holds the lock/,
    );
    await db
      .collection<{ _id: string }>("control")
      .updateOne(
        { _id: "migrations-lock" },
        { $set: { expiresAt: new Date(0) } },
      );
    assert.deepEqual((await runMigrations(db, list, () => true)).applied, []);
    assert.equal(await db.collection("control").countDocuments(), 0);

    // The lease renews while a long migration runs, so a second runner
    // cannot take it over after the original lease would have expired.
    let second: Promise<unknown> | undefined;
    const slow = step("core:0003-slow", async (target) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      second = runMigrations(target, [], () => true, { leaseMs: 600 }).then(
        () => "acquired",
        (error: Error) => error.message,
      );
      await second;
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.deepEqual(
      (await runMigrations(db, [...list, slow], () => true, { leaseMs: 600 }))
        .applied,
      ["core:0003-slow"],
    );
    assert.equal(await second, "Another migration run holds the lock.");

    // A lease lost during a run fails it before the record is written.
    const stolen = step("core:0004-stolen", async (target) => {
      await target.collection<{ _id: string }>("control").updateOne(
        { _id: "migrations-lock" },
        {
          $set: { owner: "intruder", expiresAt: new Date(Date.now() + 60_000) },
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await assert.rejects(
      runMigrations(db, [...list, slow, stolen], () => true, { leaseMs: 600 }),
      /holds the lock/,
    );
    assert.equal(
      await db
        .collection("migrations")
        .countDocuments({ _id: "core:0004-stolen" as never }),
      0,
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
