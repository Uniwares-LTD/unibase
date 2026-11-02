// Sample: notes. Removed with the sample by `npm run samples:remove -- notes`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { noteLimit } from "../../src/samples/notes/contract";
import {
  createNote,
  defaultPinned,
  deleteNote,
  listNotes,
  noteStatistics,
  updateNote,
} from "../../src/samples/notes/store";
import { notesServerExtension } from "../../src/samples/notes/server";
import { moduleEnabled } from "../../src/lib/project";
import { tools } from "../../src/lib/server/mcp/tools";

test("notes are owned, bounded and migrated additively", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("notes");
  try {
    const mine = await createNote(db, "owner", { title: "A", body: "x" });
    await createNote(db, "other", { title: "B", body: "" });
    assert.deepEqual(
      (await listNotes(db, "owner")).rows.map((row) => row.title),
      ["A"],
    );
    // Another account cannot see, change or delete the owner's note.
    for (const attempt of [
      updateNote(db, "other", mine.id, { title: "stolen", body: "" }),
      deleteNote(db, "other", mine.id),
    ])
      await assert.rejects(attempt, { code: "NOTE_NOT_FOUND", status: 404 });
    assert.equal(
      (await updateNote(db, "owner", mine.id, { title: "A2", body: "y" }))
        .title,
      "A2",
    );
    assert.deepEqual(await noteStatistics(db), { total: 2, accounts: 2 });

    await db.collection("notes").insertMany(
      Array.from({ length: noteLimit - 1 }, (_, index) => ({
        _id: `bulk-${index}`,
        uid: "owner",
        title: "bulk",
        body: "",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })) as never,
    );
    await assert.rejects(createNote(db, "owner", { title: "over", body: "" }), {
      code: "NOTE_LIMIT",
    });
    assert.equal((await listNotes(db, "owner")).rows.length, noteLimit);

    await defaultPinned(db);
    await defaultPinned(db);
    assert.equal(
      await db.collection("notes").countDocuments({ pinned: false }),
      noteLimit + 1,
    );
    await deleteNote(db, "owner", mine.id);
    await assert.rejects(deleteNote(db, "owner", mine.id), {
      code: "NOTE_NOT_FOUND",
    });
  } finally {
    await client.close();
    await repl.stop();
  }
});

test("the notes MCP tool joins the catalog and validates drafts only", async () => {
  assert.equal(moduleEnabled("notes"), true);
  const tool = tools.find((entry) => entry.name === "validate_note_draft_v1");
  assert.ok(tool);
  assert.equal(notesServerExtension.mcpTools?.[0], tool);
  const context = {
    clientId: "test",
    appName: "Base",
    requestId: crypto.randomUUID(),
    signal: new AbortController().signal,
  };
  assert.deepEqual(await tool.run({ title: "  Hi  ", body: "" }, context), {
    valid: true,
    title: "Hi",
    body: "",
    issues: [],
  });
  assert.deepEqual((await tool.run({ title: " ", body: "" }, context)).issues, [
    "title",
  ]);
});
