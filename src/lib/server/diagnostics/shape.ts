import "server-only";

// Defense in depth behind explicit projections: these keys never leave
// diagnostics, whatever a stored document happens to contain.
const sensitiveKeys = new Set(
  [
    "token",
    "ciphertext",
    "secret",
    "password",
    "apikey",
    "api_key",
    "authorization",
    "verifier",
    "salt",
    "cursorkey",
    "checkouturl",
    "leasetoken",
    "lease",
    "privatekey",
    "private_key",
    "credential",
    "credentials",
    "signedurl",
    "requesthash",
  ].map((key) => key.toLowerCase()),
);
export const MAX_TEXT = 32 * 1024;
const MAX_ITEMS = 200;
const MAX_DEPTH = 12;

/**
 * Copy stored JSON-like data as inert data: strip sensitive keys, bound strings,
 * arrays and depth, and convert dates/ObjectIds. Reports whether it truncated.
 */
export function bounded(value: unknown, maxText = MAX_TEXT) {
  let truncated = false;
  const copy = (item: unknown, depth: number): unknown => {
    if (item === null || item === undefined) return null;
    if (item instanceof Date) return item.toISOString();
    if (typeof item === "string") {
      if (item.length <= maxText) return item;
      truncated = true;
      return item.slice(0, maxText);
    }
    if (typeof item === "number" || typeof item === "boolean") return item;
    if (typeof item === "bigint") return item.toString();
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return null;
    }
    if (Array.isArray(item)) {
      if (item.length > MAX_ITEMS) truncated = true;
      return item.slice(0, MAX_ITEMS).map((entry) => copy(entry, depth + 1));
    }
    if (typeof item === "object") {
      const named = (item as { _bsontype?: string })._bsontype;
      if (named === "ObjectId") return String(item);
      if (named) return null;
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(item)) {
        if (sensitiveKeys.has(key.toLowerCase())) continue;
        output[key] = copy(entry, depth + 1);
      }
      return output;
    }
    return null;
  };
  return { value: copy(value, 0), truncated };
}
export const clean = (value: unknown) => bounded(value).value;
