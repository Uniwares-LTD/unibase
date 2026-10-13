import en from "../../../messages/en.json";
import ar from "../../../messages/ar.json";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { z } from "zod";
import {
  notificationParamsSchema,
  notificationPreferencesSchema,
  notificationTemplateSchema,
} from "../contracts/notifications";
import { moduleEnabled } from "../project";
import { AppError } from "../auth-policy";
import { parseInput } from "../input";
import { PAGE_SIZE, pageCursor, readCursor } from "./pagination";
type Preferences = z.infer<typeof notificationPreferencesSchema>;
type Template = z.infer<typeof notificationTemplateSchema>;
type Params = z.infer<typeof notificationParamsSchema>;
type Intent = {
  _id: string;
  uid: string;
  template: Template;
  params: Params;
  createdAt: Date;
  expiresAt: Date;
  state: "pending" | "done";
  nextAt: Date;
  lease?: string;
};
type Notification = Omit<Intent, "state" | "nextAt" | "lease"> & {
  read: boolean;
};
const defaults: Preferences = { runs: true, credits: true, account: true };
const inbox = (db: Db) => db.collection<Notification>("notifications");
const outbox = (db: Db) => db.collection<Intent>("notificationOutbox");
const preferences = (db: Db) =>
  db.collection<{ _id: string; values: Preferences; fence: number }>(
    "notificationPreferences",
  );
const category = (template: Template): keyof Preferences =>
  template.startsWith("run-")
    ? "runs"
    : template.startsWith("credit-")
      ? "credits"
      : "account";

export async function pruneNotifications(db: Db) {
  const now = new Date();
  const expired = await inbox(db)
    .find({ expiresAt: { $lte: now } }, { projection: { _id: 1 } })
    .limit(100)
    .toArray();
  if (expired.length)
    await inbox(db).deleteMany({
      _id: { $in: expired.map((row) => row._id) },
      expiresAt: { $lte: now },
    });
  const done = await outbox(db)
    .find(
      { state: "done", expiresAt: { $lte: now } },
      { projection: { _id: 1 } },
    )
    .limit(100)
    .toArray();
  // Retain only the hashed event tombstone to prevent replay after retention.
  if (done.length)
    await outbox(db).updateMany(
      { _id: { $in: done.map((row) => row._id) }, state: "done" },
      {
        $unset: {
          uid: "",
          template: "",
          params: "",
          createdAt: "",
          expiresAt: "",
          nextAt: "",
        },
      },
    );
}
export async function enqueueNotification(
  db: Db,
  uid: string,
  event: string,
  template: Template,
  params: Params,
  session: ClientSession,
  now = new Date(),
) {
  if (!moduleEnabled("notifications")) return;
  notificationTemplateSchema.parse(template);
  notificationParamsSchema.parse(params);
  const id = createHash("sha256")
    .update(JSON.stringify([uid, event]))
    .digest("hex");
  await outbox(db).updateOne(
    { _id: id },
    {
      $setOnInsert: {
        uid,
        template,
        params,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 90 * 86400000),
        state: "pending",
        nextAt: now,
      },
    },
    { upsert: true, session },
  );
}
export async function processOneNotification(db: Db) {
  const lease = randomUUID(),
    now = new Date();
  const intent = await outbox(db).findOneAndUpdate(
    { state: "pending", nextAt: { $lte: now } },
    { $set: { lease, nextAt: new Date(now.getTime() + 60000) } },
    { returnDocument: "after" },
  );
  if (!intent) return false;
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await outbox(db).findOne(
        { _id: intent._id, state: "pending", lease },
        { session },
      );
      if (!current) return;
      const prefs = await preferences(db).findOneAndUpdate(
        { _id: intent.uid },
        { $inc: { fence: 1 }, $setOnInsert: { values: defaults } },
        { upsert: true, returnDocument: "after", session },
      );
      if (
        intent.expiresAt > now &&
        (prefs?.values ?? defaults)[category(intent.template)]
      )
        await inbox(db).updateOne(
          { _id: intent._id },
          {
            $setOnInsert: {
              uid: intent.uid,
              template: intent.template,
              params: intent.params,
              createdAt: intent.createdAt,
              expiresAt: intent.expiresAt,
              read: false,
            },
          },
          { upsert: true, session },
        );
      const changed = await outbox(db).updateOne(
        { _id: intent._id, lease, state: "pending" },
        { $set: { state: "done" }, $unset: { lease: "" } },
        { session },
      );
      if (!changed.matchedCount) throw new Error("Notification lease changed");
    });
  } finally {
    await session.endSession();
  }
  return true;
}
export async function notificationPreferences(db: Db, uid: string) {
  return (await preferences(db).findOne({ _id: uid }))?.values ?? defaults;
}
export async function saveNotificationPreferences(
  db: Db,
  uid: string,
  value: unknown,
) {
  const values = parseInput(notificationPreferencesSchema, value);
  await preferences(db).updateOne(
    { _id: uid },
    { $set: { values }, $inc: { fence: 1 } },
    { upsert: true },
  );
  return values;
}
export function notificationText(
  template: Template,
  _params: Params,
  locale: "en" | "ar" = "en",
) {
  return (locale === "ar" ? ar : en).notifications[template];
}
export async function notificationPage(
  db: Db,
  uid: string,
  cursor?: string,
  locale: "en" | "ar" = "en",
) {
  const scope = ["notifications", uid],
    after = readCursor(cursor, scope),
    now = new Date();
  if (
    after &&
    (typeof after.value !== "string" ||
      !Number.isFinite(Date.parse(after.value)))
  )
    throw new AppError("INVALID_INPUT", "Invalid page cursor.");
  const rows = await inbox(db)
    .find({
      uid,
      expiresAt: { $gt: now },
      ...(after
        ? {
            $or: [
              { createdAt: { $lt: new Date(after.value) } },
              { createdAt: new Date(after.value), _id: { $lt: after.id } },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();
  const shown = rows.slice(0, PAGE_SIZE),
    last = shown.at(-1);
  return {
    rows: shown.map((row) => ({
      id: row._id,
      template: row.template,
      params: row.params,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
      text: notificationText(row.template, row.params, locale),
      href: `/api/notifications/${row._id}/open`,
    })),
    next:
      rows.length > PAGE_SIZE && last
        ? pageCursor(scope, last.createdAt.toISOString(), last._id)
        : null,
    unread: await inbox(db).countDocuments({
      uid,
      read: false,
      expiresAt: { $gt: now },
    }),
    preferences: await notificationPreferences(db, uid),
  };
}
export async function markNotificationsRead(
  db: Db,
  uid: string,
  ids?: string[],
) {
  if (ids)
    parseInput(
      z
        .array(z.string().regex(/^[a-f0-9]{64}$/))
        .min(1)
        .max(100),
      ids,
    );
  await inbox(db).updateMany(
    {
      uid,
      read: false,
      expiresAt: { $gt: new Date() },
      ...(ids ? { _id: { $in: ids } } : {}),
    },
    { $set: { read: true } },
  );
}
export async function notificationDestination(db: Db, uid: string, id: string) {
  parseInput(z.string().regex(/^[a-f0-9]{64}$/), id);
  const row = await inbox(db).findOne({
    _id: id,
    uid,
    expiresAt: { $gt: new Date() },
  });
  if (!row) throw new AppError("NOT_FOUND", "Notification unavailable.", 404);
  if (row.params.runId) {
    if (
      !(await db.collection("aiJobs").findOne({
        uid,
        "run.logicalId": row.params.runId,
        cleanedAt: { $exists: false },
      }))
    )
      throw new AppError("RUN_NOT_FOUND", "Run unavailable.", 404);
    return `/runs/${encodeURIComponent(row.params.runId)}`;
  }
  return category(row.template) === "credits" ? "/credits" : "/account";
}
