import "server-only";
import { randomUUID } from "node:crypto";
import type { UserRecord } from "firebase-admin/auth";
import { AppError, requireRecentLogin } from "../auth-policy";
import { adminAuth } from "./firebase";
import { database } from "./mongo";
import { requireSession } from "./session";
import {
  accountAccess,
  accessPermitsSession,
  accessTransaction,
  changeAccess,
  type AuditEntry,
} from "./store/access";
import {
  adminChangeSchema,
  adminProfileSchema,
  uidSchema,
} from "../contracts/admin";

export async function requireAdmin(recent = false) {
  const session = await requireSession();
  const access = await accountAccess(database(), session.uid);
  if (
    access.role !== "admin" ||
    !accessPermitsSession(access, session.auth_time)
  )
    throw new AppError("FORBIDDEN", "Administrator access is required.", 403);
  if (recent) requireRecentLogin(session);
  return session;
}

export async function listManagedUsers(query = "", pageToken?: string) {
  await requireAdmin();
  if (query.length > 320 || (pageToken?.length ?? 0) > 2048)
    throw new AppError(
      "INVALID_INPUT",
      "Search by an exact email or Firebase UID.",
    );
  let users: UserRecord[];
  let nextPageToken: string | undefined;
  if (query) {
    try {
      users = [
        await (query.includes("@")
          ? adminAuth().getUserByEmail(query)
          : adminAuth().getUser(query)),
      ];
    } catch (error) {
      if ((error as { code?: string }).code === "auth/user-not-found")
        users = [];
      else throw error;
    }
  } else {
    const result = await adminAuth().listUsers(25, pageToken);
    users = result.users;
    nextPageToken = result.pageToken;
  }
  const rows = await managedRows(users);
  return { rows, nextPageToken };
}

async function managedRows(users: UserRecord[]) {
  return Promise.all(
    users.map(async (user) => {
      const [access, profile] = await Promise.all([
        accountAccess(database(), user.uid),
        database()
          .collection("profiles")
          .findOne({ uid: user.uid }, { projection: { displayName: 1 } }),
      ]);
      return {
        uid: user.uid,
        email: user.email ?? "",
        verified: user.emailVerified,
        displayName: String(profile?.displayName ?? user.displayName ?? ""),
        role: access.role,
        status: access.status,
        providerDisabled: user.disabled,
      };
    }),
  );
}

export async function getManagedUser(uid: string) {
  await requireAdmin();
  uidSchema.parse(uid);
  try {
    return (await managedRows([await adminAuth().getUser(uid)]))[0];
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found")
      return null;
    throw error;
  }
}

export async function updateManagedAccess(input: unknown) {
  const parsed = adminChangeSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "INVALID_INPUT",
      "Choose a role, account status and a reason of 5–300 characters.",
    );
  const actor = await requireAdmin(true);
  const user = await adminAuth().getUser(parsed.data.targetUid);
  if (
    parsed.data.role === "admin" &&
    parsed.data.status === "active" &&
    (!user.emailVerified || !user.email || user.disabled)
  )
    throw new AppError(
      "INVALID_ADMIN",
      "An active administrator needs a verified, enabled email account.",
      409,
    );
  return changeAccess(
    database(),
    actor.uid,
    user.uid,
    { role: parsed.data.role, status: parsed.data.status },
    parsed.data.reason,
    actor.auth_time,
  );
}

export async function updateManagedProfile(input: unknown) {
  const parsed = adminProfileSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "INVALID_INPUT",
      "Enter a name and a reason of 5–300 characters.",
    );
  const actor = await requireAdmin(true);
  const user = await adminAuth().getUser(parsed.data.targetUid);
  if (!user.email)
    throw new AppError(
      "INVALID_PROFILE",
      "This account needs an email before an application profile can be edited.",
      409,
    );
  const db = database();
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const collection = db.collection("profiles");
      const before = await collection.findOne({ uid: user.uid }, { session });
      await collection.updateOne(
        { uid: user.uid },
        {
          $set: {
            displayName: parsed.data.displayName,
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: {
            uid: user.uid,
            email: user.email ?? "",
            theme: "system",
          },
        },
        { upsert: true, session },
      );
      await db.collection<AuditEntry>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "admin-profile-edit",
          actorUid: actor.uid,
          targetUid: user.uid,
          reason: parsed.data.reason,
          timestamp: new Date(),
          before: {
            displayName:
              typeof before?.displayName === "string"
                ? before.displayName
                : undefined,
          },
          after: { displayName: parsed.data.displayName },
        },
        { session },
      );
    },
    actor.auth_time,
  );
}
