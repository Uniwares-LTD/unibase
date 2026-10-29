import "server-only";
import type { Db } from "mongodb";
import { AppError } from "../../auth-policy";
import { accountAccess, accessPermitsSession } from "../store/access";
import {
  grantIdPattern,
  type GrantRecord,
  type GrantStore,
} from "./grant-store";
import { verifyPhrase } from "./grants";

export const GLOBAL_ATTEMPTS_PER_MINUTE = 120;
export const GRANT_REQUESTS_PER_MINUTE = 30;
export type DiagnosticOperator = {
  grantId: string;
  uid: string;
  capabilities: ReadonlySet<string>;
  cursorKey: Buffer;
  expiresAt: number;
};
export type IdentityUser = {
  disabled: boolean;
  emailVerified: boolean;
  tokensValidAfterTime?: string;
};
type Dependencies = {
  db: Db;
  store: GrantStore;
  /** Returns null when the account no longer exists. */
  getUser: (uid: string) => Promise<IdentityUser | null>;
  now?: () => number;
};

// One generic failure avoids revealing which check rejected a credential.
const denied = () =>
  new AppError("DIAGNOSTIC_UNAUTHORIZED", "Diagnostic access denied.", 401);
const unavailable = () =>
  new AppError(
    "DIAGNOSTICS_UNAVAILABLE",
    "Diagnostic access cannot be verified right now.",
    503,
  );
export class DiagnosticRateError extends AppError {
  constructor(public retryAfter: number) {
    super("RATE_LIMITED", "Too many diagnostic requests.", 429);
  }
}
// Identity checks run before the handler deadline; bound them separately.
const IDENTITY_TIMEOUT_MS = 4000;
function within<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("timeout")),
        IDENTITY_TIMEOUT_MS,
      ).unref?.(),
    ),
  ]);
}
const credentialPattern =
  /^Bearer ([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32,342})$/;

export function parseCredential(header: string | null) {
  const match = credentialPattern.exec(header ?? "");
  if (!match) return null;
  const phrase = Buffer.from(match[2], "base64url");
  if (phrase.length < 24 || phrase.length > 256) return null;
  return { grantId: match[1], phrase };
}

/**
 * Checks run cheapest first: the shared pre-authentication limit, grant
 * lookup, the per-grant limit, scrypt verification, then identity and role.
 */
export async function authenticateOperator(
  header: string | null,
  { db, store, getUser, now = Date.now }: Dependencies,
): Promise<DiagnosticOperator> {
  const limited = async (
    bucket: Parameters<GrantStore["hit"]>[0],
    limit: number,
  ) => {
    let result;
    try {
      result = await store.hit(bucket);
    } catch {
      throw unavailable();
    }
    if (result.count > limit) throw new DiagnosticRateError(result.retryAfter);
  };
  await limited({ kind: "global" }, GLOBAL_ATTEMPTS_PER_MINUTE);
  const credential = parseCredential(header);
  if (!credential || !grantIdPattern.test(credential.grantId)) throw denied();
  let grant: GrantRecord | null;
  try {
    grant = await store.get(credential.grantId, now());
  } catch {
    throw unavailable();
  }
  if (!grant) throw denied();
  await limited({ kind: "grant", id: grant.id }, GRANT_REQUESTS_PER_MINUTE);
  let matches;
  try {
    matches = await verifyPhrase(grant, credential.phrase);
  } catch {
    throw denied();
  }
  if (!matches) throw denied();
  let user;
  try {
    user = await within(getUser(grant.issuerUid));
  } catch {
    throw unavailable();
  }
  const validAfter = user?.tokensValidAfterTime
    ? Date.parse(user.tokensValidAfterTime) / 1000
    : 0;
  if (
    !user ||
    user.disabled ||
    !user.emailVerified ||
    (Number.isFinite(validAfter) && validAfter > grant.authTime)
  )
    throw denied();
  let access;
  try {
    access = await within(accountAccess(db, grant.issuerUid));
  } catch {
    throw unavailable();
  }
  // Any access change bumps the revision, so demotion then promotion does
  // not revive an older grant.
  if (
    access.role !== "admin" ||
    !accessPermitsSession(access, grant.authTime) ||
    access.revision !== grant.accessRevision
  )
    throw denied();
  return {
    grantId: grant.id,
    uid: grant.issuerUid,
    capabilities: new Set(grant.capabilities),
    cursorKey: Buffer.from(grant.cursorKey, "base64url"),
    expiresAt: grant.expiresAt,
  };
}
