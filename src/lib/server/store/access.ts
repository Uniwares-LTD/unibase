import { enqueueNotification } from "../notifications";
import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "../../auth-policy";

export type AccountAccess = {
  _id: string;
  role: "member" | "admin";
  status: "active" | "suspended";
  notBefore: number;
  revision: number;
  updatedAt: Date;
};
export type AuditEntry = {
  _id: string;
  event:
    | "admin-bootstrap"
    | "access-change"
    | "admin-profile-edit"
    | "credit-adjustment"
    | "ai-resolution"
    | "ai-cleanup"
    | "payment-review"
    | "execution-profile"
    | "diagnostic-grant-requested"
    | "diagnostic-grant-activated"
    | "diagnostic-grant-failed"
    | "diagnostic-grant-revoked";
  actorUid: string;
  targetUid: string;
  reason: string;
  timestamp: Date;
  // Diagnostic grant lifecycle only; never the phrase or verifier.
  grant?: { id: string; capabilities: string[]; expiresAt: Date };
  before?: {
    role?: string;
    status?: string;
    displayName?: string;
    balance?: number;
    debt?: number;
  };
  after?: {
    role?: string;
    status?: string;
    displayName?: string;
    balance?: number;
    debt?: number;
  };
};
const collection = (db: Db) => db.collection<AccountAccess>("accountAccess");

export async function accountAccess(
  db: Db,
  uid: string,
  session?: ClientSession,
) {
  return (
    (await collection(db).findOne({ _id: uid }, { session })) ?? {
      _id: uid,
      role: "member" as const,
      status: "active" as const,
      notBefore: 0,
      revision: 0,
      updatedAt: new Date(0),
    }
  );
}

export function accessPermitsSession(access: AccountAccess, authTime: number) {
  return access.status === "active" && authTime >= access.notBefore;
}

export async function accessTransaction<T>(
  db: Db,
  actorUid: string | null,
  action: (session: ClientSession) => Promise<T>,
  authTime?: number,
) {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        // Every admin change writes the same document. Snapshot isolation alone
        // would allow two admins to remove each other in separate transactions.
        await db
          .collection<{ _id: string; tick: number }>("control")
          .updateOne(
            { _id: "admin-access" },
            { $inc: { tick: 1 } },
            { upsert: true, session },
          );
        if (actorUid !== null) {
          const actor = await accountAccess(db, actorUid, session);
          if (
            actor.role !== "admin" ||
            actor.status !== "active" ||
            (authTime !== undefined && !accessPermitsSession(actor, authTime))
          )
            throw new AppError(
              "FORBIDDEN",
              "Administrator access is required.",
              403,
            );
        }
        return action(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
}

export async function appointFirstAdmin(db: Db, uid: string, reason: string) {
  return accessTransaction(db, null, (session) =>
    appointAdmin(db, uid, reason, session),
  );
}

// Only call with identity claims verified by the configured Firebase Admin SDK.
export async function initializeSignupAdmin(
  db: Db,
  identity: {
    uid: string;
    email?: string;
    email_verified?: boolean;
    auth_time: number;
  },
) {
  if (
    identity.email_verified !== true ||
    identity.email?.toLowerCase() !== "admin@uniwares.co.uk"
  )
    return false;
  return accessTransaction(db, null, async (session) => {
    const initialized = await db
      .collection<{ _id: string }>("control")
      .findOne({ _id: "signup-admin-initializer" }, { session });
    if (initialized) return false;
    // Suspended administrators also prevent automatic replacement.
    if (await collection(db).countDocuments({ role: "admin" }, { session }))
      return false;
    const access = await accountAccess(db, identity.uid, session);
    if (!accessPermitsSession(access, identity.auth_time)) return false;
    await appointAdmin(
      db,
      identity.uid,
      "Verified first-admin email initializer",
      session,
      "initializer",
    );
    return true;
  });
}

async function appointAdmin(
  db: Db,
  uid: string,
  reason: string,
  session: ClientSession,
  actorUid = "operator",
) {
  if (
    await collection(db).countDocuments(
      { role: "admin", status: "active" },
      { session },
    )
  )
    throw new AppError(
      "ADMIN_EXISTS",
      "An active admin already exists; use user management.",
      409,
    );
  const before = await accountAccess(db, uid, session);
  if (before.status !== "active")
    throw new AppError(
      "ACCOUNT_SUSPENDED",
      "Reactivate this account before appointing it.",
      409,
    );
  await collection(db).replaceOne(
    { _id: uid },
    {
      ...before,
      role: "admin",
      revision: before.revision + 1,
      updatedAt: new Date(),
    },
    { upsert: true, session },
  );
  await db.collection<AuditEntry>("auditEvents").insertOne(
    {
      _id: randomUUID(),
      event: "admin-bootstrap",
      actorUid,
      targetUid: uid,
      reason,
      timestamp: new Date(),
      before: { role: before.role },
      after: { role: "admin" },
    },
    { session },
  );
  await db
    .collection<{ _id: string; uid: string }>("control")
    .updateOne(
      { _id: "signup-admin-initializer" },
      { $setOnInsert: { uid } },
      { upsert: true, session },
    );
}

export async function changeAccess(
  db: Db,
  actorUid: string,
  targetUid: string,
  patch: Pick<AccountAccess, "role" | "status">,
  reason: string,
  authTime?: number,
) {
  return accessTransaction(
    db,
    actorUid,
    async (session) => {
      const before = await accountAccess(db, targetUid, session);
      if (
        actorUid === targetUid &&
        (patch.role !== "admin" || patch.status !== "active")
      )
        throw new AppError(
          "SELF_CHANGE_DENIED",
          "You cannot remove your own administrator access.",
          409,
        );
      if (
        before.role === "admin" &&
        before.status === "active" &&
        (patch.role !== "admin" || patch.status !== "active") &&
        (await collection(db).countDocuments(
          { role: "admin", status: "active" },
          { session },
        )) <= 1
      )
        throw new AppError(
          "LAST_ADMIN",
          "Keep at least one active administrator.",
          409,
        );
      const updated = {
        ...before,
        ...patch,
        // Reactivation must not resurrect a pre-suspension cookie or ID token.
        notBefore:
          patch.status === "suspended"
            ? Math.floor(Date.now() / 1000) + 1
            : before.notBefore,
        revision: before.revision + 1,
        updatedAt: new Date(),
      };
      await collection(db).replaceOne({ _id: targetUid }, updated, {
        upsert: true,
        session,
      });
      await db.collection<AuditEntry>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "access-change",
          actorUid,
          targetUid,
          reason,
          timestamp: new Date(),
          before: { role: before.role, status: before.status },
          after: patch,
        },
        { session },
      );
      if (before.role !== updated.role || before.status !== updated.status)
        await enqueueNotification(
          db,
          targetUid,
          `access:${updated.revision}`,
          "account-access",
          { role: updated.role, status: updated.status },
          session,
        );
      return updated;
    },
    authTime,
  );
}
