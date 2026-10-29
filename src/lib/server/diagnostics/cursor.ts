import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../auth-policy";

const CURSOR_SECONDS = 3600;
const bodySchema = z.strictObject({
  g: z.string().max(32),
  c: z.string().max(64),
  q: z.string().length(64),
  e: z.number().int(),
  v: z.union([z.string().max(200), z.number()]),
  i: z.string().max(200),
});
export type CursorScope = {
  key: Buffer;
  grantId: string;
  capability: string;
  /** Normalized criteria, excluding the cursor itself. */
  criteria: unknown;
  grantExpiresAt: number;
  now: number;
};
const criteriaHash = (criteria: unknown) =>
  createHash("sha256").update(JSON.stringify(criteria)).digest("hex");
const invalid = () =>
  new AppError("INVALID_CURSOR", "The page cursor is invalid or expired.");

/** Signed cursors are bound to grant, capability, criteria and expiry. */
export function signCursor(
  scope: CursorScope,
  value: string | number,
  id: string,
) {
  const body = Buffer.from(
    JSON.stringify({
      g: scope.grantId,
      c: scope.capability,
      q: criteriaHash(scope.criteria),
      e: Math.min(scope.grantExpiresAt, scope.now + CURSOR_SECONDS * 1000),
      v: value,
      i: id,
    }),
  ).toString("base64url");
  const mac = createHmac("sha256", scope.key).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function readCursor(scope: CursorScope, cursor: string | undefined) {
  if (cursor === undefined) return null;
  const [body, mac, extra] = cursor.split(".");
  if (!body || !mac || extra !== undefined || cursor.length > 1024)
    throw invalid();
  const expected = createHmac("sha256", scope.key).update(body).digest();
  const supplied = Buffer.from(mac, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw invalid();
  let parsed;
  try {
    parsed = bodySchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    throw invalid();
  }
  if (
    parsed.g !== scope.grantId ||
    parsed.c !== scope.capability ||
    parsed.q !== criteriaHash(scope.criteria) ||
    parsed.e <= scope.now
  )
    throw invalid();
  return { value: parsed.v, id: parsed.i };
}
