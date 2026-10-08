import "server-only";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import {
  executionProfileSchema,
  profileSaveSchema,
  profileSummarySchema,
  type ExecutionProfile,
  type ProfileReference,
} from "@/lib/contracts/execution-profile";
import {
  accessTransaction,
  accountAccess,
  type AuditEntry,
} from "../store/access";
import { fingerprint } from "../ai/jobs";
import { aiConfig, bindingSnapshot } from "../ai/capabilities";

type Head = ExecutionProfile & { _id: string; selectionTick: number };
type Version = ExecutionProfile & {
  _id: string;
  actorUid: string;
  reason: string;
};
const heads = (db: Db) => db.collection<Head>("executionProfiles");
const versions = (db: Db) => db.collection<Version>("executionProfileVersions");
export async function createProfileIndexes(db: Db) {
  await versions(db).createIndex({ id: 1, revision: -1 }, { unique: true });
}
export async function saveExecutionProfile(
  db: Db,
  actor: { uid: string; authTime: number },
  input: unknown,
) {
  const command = profileSaveSchema.parse(input);
  if (command.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  return accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const operations = db.collection<{
        _id: string;
        hash: string;
        result: ExecutionProfile;
      }>("executionProfileOperations");
      const operationId = fingerprint([actor.uid, command.key]);
      const hash = fingerprint(command);
      const prior = await operations.findOne({ _id: operationId }, { session });
      if (prior) {
        if (prior.hash !== hash)
          throw new AppError(
            "PROFILE_CONFLICT",
            "This request key was already used.",
            409,
          );
        return prior.result;
      }
      // Resolve only server-configured bindings. Exact retries still return their
      // recorded result after configuration changes; credentials are never stored.
      if (command.definition.enabled)
        bindingSnapshot(
          command.definition.capability,
          aiConfig(),
          command.definition.binding ?? undefined,
        );
      const current = await heads(db).findOne({ _id: command.id }, { session });
      if (
        (current?.revision ?? 0) !== command.revision ||
        (current && current.capability !== command.definition.capability)
      )
        throw new AppError(
          "PROFILE_CONFLICT",
          "The profile changed. Reload before publishing a revision; its task cannot change.",
          409,
        );
      if (!current && (await heads(db).countDocuments({}, { session })) >= 100)
        throw new AppError(
          "PROFILE_LIMIT",
          "This template supports 100 execution profiles.",
          409,
        );
      const result = executionProfileSchema.parse({
        ...command.definition,
        id: command.id,
        revision: command.revision + 1,
        createdAt: new Date().toISOString(),
      });
      await versions(db).insertOne(
        {
          ...result,
          _id: `${result.id}:${result.revision}`,
          actorUid: actor.uid,
          reason: command.reason,
        },
        { session },
      );
      await heads(db).replaceOne(
        { _id: result.id },
        {
          ...result,
          selectionTick: current?.selectionTick ?? 0,
        },
        { session, upsert: true },
      );
      await operations.insertOne(
        { _id: operationId, hash, result },
        { session },
      );
      await db.collection<AuditEntry>("auditEvents").insertOne(
        {
          _id: operationId,
          event: "execution-profile",
          actorUid: actor.uid,
          targetUid: actor.uid,
          timestamp: new Date(),
          reason: `${result.id} revision ${result.revision}: ${command.reason}`,
        },
        { session },
      );
      return result;
    },
    actor.authTime,
  );
}
export async function listExecutionProfiles(db: Db) {
  return (
    await heads(db).find().sort({ name: 1, _id: 1 }).limit(100).toArray()
  ).map((row) => executionProfileSchema.parse(row));
}
export async function profileHistory(
  db: Db,
  id: string,
  before = Number.MAX_SAFE_INTEGER,
) {
  const rows = await versions(db)
    .find({ id, revision: { $lt: before } })
    .sort({ revision: -1 })
    .limit(26)
    .toArray();
  return {
    versions: rows.slice(0, 25).map((row) => ({
      ...executionProfileSchema.parse(row),
      reason: row.reason,
      actorUid: row.actorUid,
    })),
    next: rows.length > 25 ? rows[24].revision : null,
  };
}
export async function availableProfiles(db: Db, uid: string) {
  const access = await accountAccess(db, uid);
  if (access.status !== "active") return [];
  const config = aiConfig();
  const records = await heads(db)
    .find({
      enabled: true,
      ...(access.role === "admin" ? {} : { audience: "everyone" as const }),
    })
    .limit(100)
    .toArray();
  return records.flatMap((row) => {
    try {
      bindingSnapshot(row.capability, config, row.binding ?? undefined);
      return [profileSummarySchema.parse(row)];
    } catch {
      return [];
    }
  });
}
export async function resolveProfile(
  db: Db,
  uid: string,
  reference: ProfileReference,
  capability: string,
  hasSource: boolean,
  session: ClientSession,
) {
  // Write the head to serialize selection with disable/publication changes.
  const profile = await heads(db).findOneAndUpdate(
    { _id: reference.id, revision: reference.revision, enabled: true },
    { $inc: { selectionTick: 1 } },
    { session, returnDocument: "after" },
  );
  const access = await accountAccess(db, uid, session);
  if (
    !profile ||
    profile.capability !== capability ||
    (profile.audience === "admins" && access.role !== "admin") ||
    (profile.requiresSource && !hasSource)
  )
    throw new AppError(
      "PROFILE_UNAVAILABLE",
      "The selected profile changed or is not eligible for this task and its sources. Reload and review your selection.",
      409,
    );
  return executionProfileSchema.parse(profile);
}
