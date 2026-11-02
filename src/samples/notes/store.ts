// Sample: notes. Owned persistence: every query filters by the caller's uid.
import "server-only";
import type { Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { noteLimit, type Note, type NoteInput } from "./contract";

type StoredNote = {
  _id: string;
  uid: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
};
const notes = (db: Db) => db.collection<StoredNote>("notes");
const missing = () =>
  new AppError("NOTE_NOT_FOUND", "This note is unavailable.", 404);
const view = (row: StoredNote): Note => ({
  id: row._id,
  title: row.title,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function createNoteIndexes(db: Db) {
  await notes(db).createIndex({ uid: 1, createdAt: -1, _id: -1 });
}

export async function listNotes(db: Db, uid: string) {
  const rows = await notes(db)
    .find({ uid })
    .sort({ createdAt: -1, _id: -1 })
    .limit(noteLimit)
    .toArray();
  return { rows: rows.map(view) };
}

// The count check is advisory under concurrency; the limit bounds storage per
// account rather than guaranteeing an exact maximum.
export async function createNote(db: Db, uid: string, input: NoteInput) {
  if ((await notes(db).countDocuments({ uid })) >= noteLimit)
    throw new AppError("NOTE_LIMIT", "You have reached the note limit.", 409);
  const now = new Date();
  const row: StoredNote = {
    _id: crypto.randomUUID(),
    uid,
    ...input,
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };
  await notes(db).insertOne(row);
  return view(row);
}

export async function updateNote(
  db: Db,
  uid: string,
  id: string,
  input: NoteInput,
) {
  const row = await notes(db).findOneAndUpdate(
    { _id: id, uid },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!row) throw missing();
  return view(row);
}

export async function deleteNote(db: Db, uid: string, id: string) {
  if (!(await notes(db).deleteOne({ _id: id, uid })).deletedCount)
    throw missing();
}

// Administrator aggregate only; it exposes no note content.
export async function noteStatistics(db: Db) {
  const [total, accounts] = await Promise.all([
    notes(db).countDocuments(),
    notes(db)
      .distinct("uid")
      .then((uids) => uids.length),
  ]);
  return { total, accounts };
}

// notes:0001 — earlier sample data lacked `pinned`; additive and repeatable.
export async function defaultPinned(db: Db) {
  await notes(db).updateMany(
    { pinned: { $exists: false } },
    { $set: { pinned: false } },
  );
}
