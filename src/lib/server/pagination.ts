import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../auth-policy";

export const PAGE_SIZE = 25;
const schema = z.strictObject({
  scope: z.string().length(64),
  value: z.union([z.string().max(200), z.number().int().nonnegative()]),
  id: z.string().max(128),
});
const scopeHash = (scope: unknown[]) =>
  createHash("sha256").update(JSON.stringify(scope)).digest("hex");
export function pageCursor(scope: unknown[], value: string | number, id = "") {
  return Buffer.from(
    JSON.stringify({ scope: scopeHash(scope), value, id }),
  ).toString("base64url");
}
export function readCursor(cursor: string | undefined, scope: unknown[]) {
  if (!cursor) return null;
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor))
      throw new Error();
    const parsed = schema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString()),
    );
    if (parsed.scope !== scopeHash(scope)) throw new Error();
    return parsed;
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid page cursor.", 400);
  }
}
