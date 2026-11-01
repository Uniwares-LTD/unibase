import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import { windowScript } from "../rate-limit";
import type { RedisClient } from "../redis";

export const grantIdPattern = /^[A-Za-z0-9_-]{22}$/;
const grantSchema = z.strictObject({
  id: z.string().regex(grantIdPattern),
  issuerUid: z.string().min(1).max(128),
  authTime: z.number().int().nonnegative(),
  accessRevision: z.number().int().nonnegative(),
  capabilities: z.array(z.string().max(64)).min(1).max(64),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  salt: z.string().max(64),
  verifier: z.string().max(128),
  kdf: z.strictObject({
    N: z.number().int(),
    r: z.number().int(),
    p: z.number().int(),
    keylen: z.number().int(),
  }),
  cursorKey: z.string().max(64),
});
export type GrantRecord = z.infer<typeof grantSchema>;

/** Durable grant storage plus shared, ephemeral request protection. */
export interface GrantStore {
  create(
    grant: GrantRecord,
    limit: number,
    now: number,
  ): Promise<"created" | "limit" | "exists">;
  get(id: string, now: number): Promise<GrantRecord | null>;
  list(uid: string, now: number): Promise<GrantRecord[]>;
  revoke(uid: string, id: string): Promise<boolean>;
  /** Fixed-window counter: one shared pre-auth key and one per existing grant. */
  hit(
    bucket: { kind: "global" } | { kind: "grant"; id: string },
  ): Promise<{ count: number; retryAfter: number }>;
}

type StoredGrant = Omit<GrantRecord, "expiresAt"> & {
  _id: string;
  scope: string;
  expiresAt: Date;
};
export type GrantLimiter = Pick<GrantStore, "hit">;

export async function createGrantIndexes(db: Db) {
  const grants = db.collection<StoredGrant>("diagnosticGrants");
  await grants.createIndex({ scope: 1, id: 1 }, { unique: true });
  await grants.createIndex({ scope: 1, issuerUid: 1, expiresAt: 1 });
  await grants.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export function mongoGrantStore(
  db: Db,
  scope: string,
  limiter: GrantLimiter,
): GrantStore {
  const grants = db.collection<StoredGrant>("diagnosticGrants");
  const decode = (row: StoredGrant): GrantRecord => {
    const { _id, scope: storedScope, expiresAt, ...rest } = row;
    void _id;
    void storedScope;
    return grantSchema.parse({ ...rest, expiresAt: expiresAt.getTime() });
  };
  return {
    async create(grant, limit, now) {
      // Create the fence outside the transaction so concurrent first issuance
      // cannot race an upsert. Every issuance for this issuer writes this fence.
      const fence = `${scope}:issuer:${createHash("sha256").update(grant.issuerUid).digest("hex")}`;
      const control = db.collection<{ _id: string; tick: number }>("control");
      await control.updateOne(
        { _id: fence },
        { $setOnInsert: { tick: 0 } },
        { upsert: true, timeoutMS: 5000 },
      );
      const session = db.client.startSession();
      try {
        return await session.withTransaction(
          async () => {
            await control.updateOne(
              { _id: fence },
              { $inc: { tick: 1 } },
              { session },
            );
            if (await grants.findOne({ scope, id: grant.id }, { session }))
              return "exists" as const;
            const count = await grants.countDocuments(
              {
                scope,
                issuerUid: grant.issuerUid,
                expiresAt: { $gt: new Date(now) },
              },
              { session },
            );
            if (count >= limit) return "limit" as const;
            await grants.insertOne(
              {
                ...grant,
                _id: `${scope}:${grant.id}`,
                scope,
                expiresAt: new Date(grant.expiresAt),
              },
              { session },
            );
            return "created" as const;
          },
          {
            readConcern: { level: "snapshot" },
            writeConcern: { w: "majority" },
            timeoutMS: 5000,
          },
        );
      } finally {
        await session.endSession();
      }
    },
    async get(id, now) {
      if (!grantIdPattern.test(id)) return null;
      const row = await grants.findOne(
        { scope, id, expiresAt: { $gt: new Date(now) } },
        { timeoutMS: 1500 },
      );
      return row ? decode(row) : null;
    },
    async list(uid, now) {
      const rows = await grants
        .find(
          { scope, issuerUid: uid, expiresAt: { $gt: new Date(now) } },
          { timeoutMS: 1500 },
        )
        .toArray();
      return rows.map(decode);
    },
    async revoke(uid, id) {
      if (!grantIdPattern.test(id)) return false;
      return (
        (
          await grants.deleteOne(
            { scope, id, issuerUid: uid },
            { timeoutMS: 1500, writeConcern: { w: "majority" } },
          )
        ).deletedCount === 1
      );
    },
    hit: limiter.hit,
  };
}

/** Redis loss resets counters, never durable credentials. Fail closed on outage. */
export function redisGrantLimiter(
  client: RedisClient,
  prefix: string,
  timeoutMs = 1500,
): GrantLimiter {
  return {
    async hit(bucket) {
      const key =
        bucket.kind === "global"
          ? `${prefix}:rate:global`
          : `${prefix}:rate:grant:${bucket.id}`;
      const [count, ttl] = (await client
        .withAbortSignal(AbortSignal.timeout(timeoutMs))
        .eval(windowScript, {
          keys: [key],
          arguments: [],
        })) as number[];
      return { count, retryAfter: Math.max(1, ttl) };
    },
  };
}
