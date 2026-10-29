import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
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

/** Redis is authoritative; there is deliberately no other implementation. */
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

// Grants never outlive 24 hours; the per-issuer index lasts slightly longer.
const INDEX_TTL_MS = 25 * 3600 * 1000;
const createScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then return 0 end
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
redis.call('SET', KEYS[1], ARGV[1], 'PXAT', ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[6])
return 1`;
const revokeScript = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
if cjson.decode(value).issuerUid ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
return 1`;

export function redisGrantStore(
  client: RedisClient,
  prefix: string,
  timeoutMs = 1500,
): GrantStore {
  const grantKey = (id: string) => `${prefix}:grant:${id}`;
  const indexKey = (uid: string) =>
    `${prefix}:issuer:${createHash("sha256").update(uid).digest("hex")}`;
  const command = () => client.withAbortSignal(AbortSignal.timeout(timeoutMs));
  const parse = (value: unknown, now: number) => {
    if (typeof value !== "string") return null;
    const parsed = grantSchema.safeParse(JSON.parse(value));
    // Expiry is enforced explicitly as well as by Redis key expiry.
    return parsed.success && parsed.data.expiresAt > now ? parsed.data : null;
  };
  return {
    async create(grant, limit, now) {
      const result = await command().eval(createScript, {
        keys: [grantKey(grant.id), indexKey(grant.issuerUid)],
        arguments: [
          JSON.stringify(grant),
          String(grant.expiresAt),
          String(now),
          String(limit),
          grant.id,
          String(INDEX_TTL_MS),
        ],
      });
      return result === 1 ? "created" : result === 0 ? "limit" : "exists";
    },
    async get(id, now) {
      if (!grantIdPattern.test(id)) return null;
      return parse(await command().get(grantKey(id)), now);
    },
    async list(uid, now) {
      const ids = await command().zRangeByScore(indexKey(uid), now + 1, "+inf");
      if (!ids.length) return [];
      const values = await command().mGet(ids.map(grantKey));
      return values
        .map((value) => parse(value, now))
        .filter((grant): grant is GrantRecord => grant?.issuerUid === uid);
    },
    async revoke(uid, id) {
      if (!grantIdPattern.test(id)) return false;
      const result = await command().eval(revokeScript, {
        keys: [grantKey(id), indexKey(uid)],
        arguments: [uid, id],
      });
      return result === 1;
    },
    async hit(bucket) {
      const key =
        bucket.kind === "global"
          ? `${prefix}:rate:global`
          : `${prefix}:rate:grant:${bucket.id}`;
      const [count, ttl] = (await command().eval(windowScript, {
        keys: [key],
        arguments: [],
      })) as number[];
      return { count, retryAfter: Math.max(1, ttl) };
    },
  };
}
