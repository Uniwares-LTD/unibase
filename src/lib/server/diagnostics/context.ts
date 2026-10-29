import "server-only";
import type { Db } from "mongodb";
import type { UserRecord } from "firebase-admin/auth";
import { z } from "zod";
import type { DiagnosticOperator } from "./authenticate";

export const PAGE_SIZE = 25;
export type AccessTarget = {
  resource: string;
  id?: string;
  accountUid?: string;
};
export type DiagnosticContext = {
  db: Db;
  operator: DiagnosticOperator;
  capability: string;
  signal: AbortSignal;
  now: Date;
  /** Remaining time for one database operation (driver CSOT `timeoutMS`). */
  timeoutMS(): number;
  /** Record the affected account/resource for the access record. */
  target(target: AccessTarget): void;
  readCursor(
    criteria: unknown,
    cursor?: string,
  ): { value: string | number; id: string } | null;
  signCursor(criteria: unknown, value: string | number, id: string): string;
  identity: {
    getUser(uid: string): Promise<UserRecord | null>;
    getUserByEmail(email: string): Promise<UserRecord | null>;
  };
  redisPing(): Promise<void>;
};
export type CapabilityDefinition<I = unknown> = {
  description: string;
  /** Human-readable input description for `capabilities.list`. */
  inputs: Record<string, string>;
  input: z.ZodType<I>;
  run(context: DiagnosticContext, input: I): Promise<unknown>;
};
export const define = <I>(definition: CapabilityDefinition<I>) =>
  definition as CapabilityDefinition<unknown>;

// Equality-matched identifiers; objects and operators are never accepted.
export const uidInput = z.string().min(1).max(128);
export const idInput = z.string().min(1).max(128);
export const cursorInput = z.string().max(1024).optional();
export const dateInput = z.iso.date();
export function dateRange(from?: string, to?: string) {
  if (from && to && from > to) return null;
  return {
    ...(from ? { $gte: new Date(`${from}T00:00:00Z`) } : {}),
    ...(to ? { $lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) } : {}),
  };
}
export const iso = (value: Date | string | number | null | undefined) =>
  value === null || value === undefined ? null : new Date(value).toISOString();

/** Take one page plus a signed cursor positioned after the last row. */
export function paged<T>(
  context: DiagnosticContext,
  criteria: unknown,
  rows: T[],
  position: (row: T) => { value: string | number; id: string },
  map: (row: T) => unknown,
) {
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page.map(map),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? context.signCursor(criteria, position(last).value, position(last).id)
        : null,
  };
}
/** Descending (timestamp, _id) keyset filter from a cursor. */
export function before(
  field: string,
  cursor: { value: string | number; id: string } | null,
  idField = "_id",
) {
  if (!cursor) return {};
  const value = new Date(cursor.value);
  if (Number.isNaN(value.getTime())) return {};
  return {
    $or: [
      { [field]: { $lt: value } },
      { [field]: value, [idField]: { $lt: cursor.id } },
    ],
  };
}
