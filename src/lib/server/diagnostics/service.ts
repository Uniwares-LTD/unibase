import "server-only";
import { diagnosticsConfig } from "./availability";
import { AppError } from "../../auth-policy";
import { project } from "../../project";
import { requireAdmin } from "../admin";
import { adminAuth } from "../firebase";
import { database } from "../mongo";
import { redis, resetBrokenRedis } from "../redis";
import { redisGrantStore } from "./grant-store";
import { createGrant, listGrants, revokeGrant } from "./grants";
import type { DiagnosticsDependencies } from "./handler";
import { registry } from "./registry";

const prefix = () =>
  `${project.slug}:${process.env.APP_ENV ?? "local"}:diagnostics`;
async function store() {
  const config = diagnosticsConfig();
  if (!config.enabled)
    throw new AppError("NOT_FOUND", "Diagnostics is disabled.", 404);
  if (!config.redisUrl)
    throw new AppError(
      "DIAGNOSTICS_REDIS_UNAVAILABLE",
      "Diagnostics requires Redis. Configure REDIS_URL.",
      503,
    );
  try {
    return redisGrantStore(await redis(config.redisUrl), prefix());
  } catch {
    resetBrokenRedis();
    throw new AppError(
      "DIAGNOSTICS_REDIS_UNAVAILABLE",
      "Diagnostic access storage is unavailable.",
      503,
    );
  }
}
async function guarded<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "DIAGNOSTICS_REDIS_UNAVAILABLE") resetBrokenRedis();
      throw error;
    }
    resetBrokenRedis();
    throw new AppError(
      "DIAGNOSTICS_REDIS_UNAVAILABLE",
      "Diagnostic access storage is unavailable.",
      503,
    );
  }
}

export async function currentGrants() {
  const grants = await store();
  const session = await requireAdmin();
  return guarded(() =>
    listGrants(
      { store: grants },
      { uid: session.uid, authTime: session.auth_time },
    ),
  );
}
export async function issueGrant(input: unknown) {
  const grants = await store();
  const session = await requireAdmin();
  return guarded(() =>
    createGrant(
      { db: database(), store: grants },
      { uid: session.uid, authTime: session.auth_time },
      input,
    ),
  );
}
export async function withdrawGrant(id: string) {
  const grants = await store();
  const session = await requireAdmin();
  return guarded(() =>
    revokeGrant(
      { db: database(), store: grants },
      { uid: session.uid, authTime: session.auth_time },
      id,
    ),
  );
}

const notFound = (error: unknown) => {
  if ((error as { code?: string }).code === "auth/user-not-found") return null;
  throw error;
};
export function diagnosticsDependencies(): DiagnosticsDependencies {
  const config = diagnosticsConfig();
  return {
    config,
    db: database,
    store,
    identity: {
      getUser: (uid) => adminAuth().getUser(uid).catch(notFound),
      getUserByEmail: (email) =>
        adminAuth().getUserByEmail(email).catch(notFound),
    },
    redisPing: async () => {
      if (!config.enabled || !config.redisUrl) throw new Error("unconfigured");
      await (
        await redis(config.redisUrl)
      )
        .withAbortSignal(AbortSignal.timeout(1500))
        .ping();
    },
    registry,
  };
}
