import "server-only";
import type { Db, Filter } from "mongodb";
import { z } from "zod";
import { AppError } from "../../auth-policy";
import {
  reportFilterSchema,
  type ReportFilters,
} from "../../contracts/reports";
import type { StoredRuntimeRecord } from "./runtime";
import { accessTransaction, type AuditEntry } from "./access";
import type { CreditActor } from "./credit-types";

const DAY = 86400000;
const invalid = () =>
  new AppError(
    "INVALID_REPORT_FILTER",
    "Check the report filters and date range.",
  );
const cursorSchema = z
  .object({ timestamp: z.iso.datetime(), id: z.uuid() })
  .strict();
function cursorFilter(raw?: string) {
  if (!raw) return {};
  let decoded;
  try {
    decoded = cursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw invalid();
  }
  const timestamp = new Date(decoded.timestamp);
  return {
    $or: [
      { timestamp: { $lt: timestamp } },
      { timestamp, _id: { $lt: decoded.id } },
    ],
  };
}
function cursor(record: { timestamp: Date; _id: string }) {
  return Buffer.from(
    JSON.stringify({
      timestamp: record.timestamp.toISOString(),
      id: record._id,
    }),
  ).toString("base64url");
}
function range(filters: ReportFilters, now: Date) {
  const min =
    filters.kind === "runtime" ? new Date(now.getTime() - 30 * DAY) : undefined;
  const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : undefined;
  const lower =
    min && from
      ? new Date(Math.max(min.getTime(), from.getTime()))
      : (min ?? from);
  return {
    ...(lower ? { $gte: lower } : {}),
    ...(filters.to
      ? { $lt: new Date(new Date(`${filters.to}T00:00:00Z`).getTime() + DAY) }
      : {}),
  };
}
function state(value?: AuditEntry["before"]) {
  if (!value) return undefined;
  return {
    ...(typeof value.role === "string" ? { role: value.role } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(typeof value.displayName === "string"
      ? { displayName: value.displayName }
      : {}),
    ...(typeof value.balance === "number" ? { balance: value.balance } : {}),
    ...(typeof value.debt === "number" ? { debt: value.debt } : {}),
  };
}
export async function readReports(
  db: Db,
  admin: CreditActor,
  input: unknown,
  now = new Date(),
) {
  const parsed = reportFilterSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const filters = parsed.data;
  const before = cursorFilter(filters.cursor);
  const dates = range(filters, now);
  return accessTransaction(
    db,
    admin.uid,
    async (session) => {
      if (filters.kind === "runtime") {
        const query: Filter<StoredRuntimeRecord> = {
          timestamp: dates,
          ...(filters.severity ? { severity: filters.severity } : {}),
          ...(filters.event
            ? { event: filters.event as StoredRuntimeRecord["event"] }
            : {}),
          ...(filters.requestId
            ? { requestId: filters.requestId.toLowerCase() }
            : {}),
          ...before,
        };
        const records = await db
          .collection<StoredRuntimeRecord>("runtimeLogs")
          .find(query, { session })
          .sort({ timestamp: -1, _id: -1 })
          .limit(26)
          .toArray();
        return {
          kind: "runtime" as const,
          filters,
          rows: records.slice(0, 25).map((item) => ({
            id: item._id,
            timestamp: item.timestamp.toISOString(),
            event: item.event,
            severity: item.severity,
            status: item.status,
            durationMs: item.durationMs,
            requestId: item.requestId,
          })),
          nextCursor: records.length > 25 ? cursor(records[24]) : null,
        };
      }
      const query: Filter<AuditEntry> = {
        ...(Object.keys(dates).length ? { timestamp: dates } : {}),
        ...(filters.event
          ? { event: filters.event as AuditEntry["event"] }
          : {}),
        ...(filters.actorUid ? { actorUid: filters.actorUid } : {}),
        ...(filters.targetUid ? { targetUid: filters.targetUid } : {}),
        ...before,
      };
      const records = await db
        .collection<AuditEntry>("auditEvents")
        .find(query, { session })
        .sort({ timestamp: -1, _id: -1 })
        .limit(26)
        .toArray();
      return {
        kind: "audit" as const,
        filters,
        rows: records.slice(0, 25).map((item) => ({
          id: item._id,
          timestamp: item.timestamp.toISOString(),
          event: item.event,
          actorUid: item.actorUid,
          targetUid: item.targetUid,
          reason: item.reason,
          before: state(item.before),
          after: state(item.after),
        })),
        nextCursor: records.length > 25 ? cursor(records[24]) : null,
      };
    },
    admin.authTime,
  );
}

export async function readDashboard(
  db: Db,
  admin: CreditActor,
  now = new Date(),
) {
  return accessTransaction(
    db,
    admin.uid,
    async (session) => {
      // Do not parallelize operations inside a MongoDB transaction.
      const profiles = await db
        .collection("profiles")
        .countDocuments({}, { session });
      const admins = await db
        .collection("accountAccess")
        .countDocuments({ role: "admin", status: "active" }, { session });
      const suspended = await db
        .collection("accountAccess")
        .countDocuments({ status: "suspended" }, { session });
      const since = new Date(now.getTime() - DAY);
      const runtimeErrors = await db
        .collection("runtimeLogs")
        .countDocuments(
          { timestamp: { $gte: since }, severity: "error" },
          { session },
        );
      const auditedChanges = await db
        .collection("auditEvents")
        .countDocuments({ timestamp: { $gte: since } }, { session });
      return { profiles, admins, suspended, runtimeErrors, auditedChanges };
    },
    admin.authTime,
  );
}
