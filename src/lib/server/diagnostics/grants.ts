import "server-only";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { Db } from "mongodb";
import { AppError } from "../../auth-policy";
import {
  grantCreateSchema,
  grantDurations,
  MAX_ACTIVE_GRANTS,
  type GrantView,
} from "../../contracts/diagnostics";
import { accountAccess, type AuditEntry } from "../store/access";
import type { GrantRecord, GrantStore } from "./grant-store";

// Fixed, bounded cost. Stored with each verifier so later changes stay readable.
export const KDF = { N: 32768, r: 8, p: 1, keylen: 32 } as const;
const MAX_N = 65536;
export function derivePhrase(
  phrase: Buffer,
  salt: Buffer,
  kdf: GrantRecord["kdf"] = KDF,
): Promise<Buffer> {
  if (
    kdf.N > MAX_N ||
    kdf.N < 2 ||
    (kdf.N & (kdf.N - 1)) !== 0 ||
    kdf.r !== 8 ||
    kdf.p !== 1 ||
    kdf.keylen !== 32
  )
    return Promise.reject(new Error("Unsupported verifier parameters."));
  return new Promise((resolve, reject) =>
    scrypt(
      phrase,
      salt,
      kdf.keylen,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * MAX_N * kdf.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function verifyPhrase(grant: GrantRecord, phrase: Buffer) {
  const expected = Buffer.from(grant.verifier, "base64url");
  const actual = await derivePhrase(
    phrase,
    Buffer.from(grant.salt, "base64url"),
    grant.kdf,
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const grantView = (grant: GrantRecord): GrantView => ({
  id: grant.id,
  capabilities: grant.capabilities as GrantView["capabilities"],
  issuedAt: new Date(grant.issuedAt).toISOString(),
  expiresAt: new Date(grant.expiresAt).toISOString(),
});
const unavailable = () =>
  new AppError(
    "DIAGNOSTICS_STORAGE_UNAVAILABLE",
    "Diagnostic access storage is unavailable.",
    503,
  );
const outcomeUnknown = () =>
  new AppError(
    "DIAGNOSTIC_GRANT_OUTCOME_UNKNOWN",
    "Diagnostic access may exist until it expires. Check active grants and revoke it.",
    503,
  );
type Issuer = { uid: string; authTime: number };
type Dependencies = { db: Db; store: GrantStore; now?: () => number };

async function audit(
  db: Db,
  issuer: Issuer,
  event: Extract<AuditEntry["event"], `diagnostic-grant-${string}`>,
  grant: Pick<GrantRecord, "id" | "capabilities" | "expiresAt">,
  outcome: { uncertain?: boolean } = {},
) {
  await db.collection<AuditEntry>("auditEvents").insertOne(
    {
      _id: randomUUID(),
      event,
      actorUid: issuer.uid,
      targetUid: issuer.uid,
      reason: `grant:${grant.id}${outcome.uncertain ? " outcome-uncertain" : ""}`,
      timestamp: new Date(),
      grant: {
        id: grant.id,
        capabilities: grant.capabilities,
        expiresAt: new Date(grant.expiresAt),
      },
    },
    { timeoutMS: 5000 },
  );
}

/**
 * Issue a grant. The request is audited before activation, so a failure can
 * never leave a usable unaudited grant; an activation-audit failure revokes it.
 */
export async function createGrant(
  { db, store, now = Date.now }: Dependencies,
  issuer: Issuer,
  input: unknown,
) {
  const parsed = grantCreateSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError("INVALID_INPUT", "Check the expiry and capabilities.");
  const access = await accountAccess(db, issuer.uid);
  const secret = randomBytes(32);
  const salt = randomBytes(16);
  const issuedAt = now();
  const grant: GrantRecord = {
    id: randomBytes(16).toString("base64url"),
    issuerUid: issuer.uid,
    authTime: issuer.authTime,
    accessRevision: access.revision,
    capabilities: parsed.data.capabilities,
    issuedAt,
    expiresAt: issuedAt + grantDurations[parsed.data.duration] * 1000,
    salt: salt.toString("base64url"),
    verifier: (await derivePhrase(secret, salt)).toString("base64url"),
    kdf: { ...KDF },
    cursorKey: randomBytes(32).toString("base64url"),
  };
  await audit(db, issuer, "diagnostic-grant-requested", grant);
  let created;
  try {
    created = await store.create(grant, MAX_ACTIVE_GRANTS, now());
  } catch {
    // The grant may or may not exist; only a confirmed removal is a failure.
    const withdrawn = await store
      .revoke(issuer.uid, grant.id)
      .then(() => true)
      .catch(() => false);
    await audit(db, issuer, "diagnostic-grant-failed", grant, {
      uncertain: !withdrawn,
    }).catch(() => undefined);
    if (!withdrawn) throw outcomeUnknown();
    throw unavailable();
  }
  if (created !== "created") {
    await audit(db, issuer, "diagnostic-grant-failed", grant).catch(
      () => undefined,
    );
    throw created === "limit"
      ? new AppError(
          "DIAGNOSTIC_GRANT_LIMIT",
          `Revoke a grant first; at most ${MAX_ACTIVE_GRANTS} may be active.`,
          409,
        )
      : unavailable();
  }
  try {
    await audit(db, issuer, "diagnostic-grant-activated", grant);
  } catch {
    // A resolved revoke (deleted or already absent) confirms it is unusable.
    const withdrawn = await store
      .revoke(issuer.uid, grant.id)
      .then(() => true)
      .catch(() => false);
    if (!withdrawn) throw outcomeUnknown();
    throw new AppError(
      "DIAGNOSTIC_GRANT_UNCERTAIN",
      "Diagnostic access could not be recorded and was withdrawn.",
      503,
    );
  }
  return {
    ...grantView(grant),
    credential: `${grant.id}.${secret.toString("base64url")}`,
  };
}

export async function listGrants(
  { store, now = Date.now }: Omit<Dependencies, "db">,
  issuer: Issuer,
) {
  try {
    const grants = await store.list(issuer.uid, now());
    return {
      grants: grants.sort((a, b) => a.expiresAt - b.expiresAt).map(grantView),
      limit: MAX_ACTIVE_GRANTS,
    };
  } catch {
    throw unavailable();
  }
}

/** Invalidate first, then record the outcome. */
export async function revokeGrant(
  { db, store, now = Date.now }: Dependencies,
  issuer: Issuer,
  id: string,
) {
  const existing = await store.get(id, now()).catch(() => {
    throw unavailable();
  });
  let revoked;
  try {
    revoked = await store.revoke(issuer.uid, id);
  } catch {
    throw unavailable();
  }
  if (!revoked)
    throw new AppError(
      "DIAGNOSTIC_GRANT_NOT_FOUND",
      "That grant is not active.",
      404,
    );
  // Access is already withdrawn; report whether the record was written.
  // A just-expired or unreadable value is still recorded by ID.
  const recorded = await audit(
    db,
    issuer,
    "diagnostic-grant-revoked",
    existing ?? { id, capabilities: [], expiresAt: now() },
  )
    .then(() => true)
    .catch(() => false);
  return { ok: true as const, recorded };
}
