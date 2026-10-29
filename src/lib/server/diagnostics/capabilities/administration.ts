import "server-only";
import type { Document, Filter } from "mongodb";
import { z } from "zod";
import { AppError } from "../../../auth-policy";
import { auditEvents } from "../../../contracts/reports";
import { events as runtimeEvents } from "../../../diagnostics";
import type { OrchestratorRecord } from "../../runs/orchestrators";
import type { Persona } from "../../runs/personas";
import type { AuditEntry } from "../../store/access";
import type { StoredRuntimeRecord } from "../../store/runtime";
import {
  before,
  cursorInput,
  dateInput,
  dateRange,
  define,
  idInput,
  iso,
  PAGE_SIZE,
  paged,
  uidInput,
  type DiagnosticContext,
} from "../context";
import { accessRecords, type AccessRecord } from "../access-log";
import { clean } from "../shape";
import { storedSettings } from "./content";

const missing = () =>
  new AppError("DIAGNOSTIC_NOT_FOUND", "No matching record.", 404);
const options = (context: DiagnosticContext) => ({
  timeoutMS: context.timeoutMS(),
});

const orchestrator = (row: OrchestratorRecord) => ({
  id: row._id,
  revision: row.revision,
  name: row.definition.name,
  enabled: row.definition.enabled,
  validated: row.validated,
  lifecycle: row.lifecycle ?? "registered",
  availability: row.availability ?? "available",
  admissionSequence: row.admissionSequence ?? null,
  updatedAt: iso(row.updatedAt),
});
const pageOnly = z.strictObject({ cursor: cursorInput });
export const orchestratorSearch = define({
  description:
    "Registered orchestrators with revision, availability and lifecycle.",
  inputs: { cursor: "optional nextCursor" },
  input: pageOnly,
  async run(context, input: z.infer<typeof pageOnly>) {
    const after = context.readCursor({}, input.cursor);
    const rows = await context.db
      .collection<OrchestratorRecord>("orchestrators")
      .find(after ? { _id: { $gt: after.id } } : {}, options(context))
      .sort({ _id: 1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    return paged(
      context,
      {},
      rows,
      (row) => ({ value: 0, id: row._id }),
      orchestrator,
    );
  },
});
const idOnly = z.strictObject({ id: idInput });
export const orchestratorGet = define({
  description:
    "One orchestrator's sanitized definition (inputs, pricing, limits, private tools) and recent revisions. Credential values are never stored here.",
  inputs: { id: "exact orchestrator ID" },
  input: idOnly,
  async run(context, input: z.infer<typeof idOnly>) {
    const row = await context.db
      .collection<OrchestratorRecord>("orchestrators")
      .findOne({ _id: input.id }, options(context));
    if (!row) throw missing();
    context.target({ resource: "orchestrator", id: row._id });
    const versions = await context.db
      .collection<Document & { _id: string }>("orchestratorVersions")
      .find(
        { $or: [{ "definition.id": row._id }, { orchestratorId: row._id }] },
        {
          ...options(context),
          projection: { revision: 1, updatedAt: 1, validated: 1 },
        },
      )
      .sort({ revision: -1 })
      .limit(25)
      .toArray();
    return {
      ...orchestrator(row),
      definition: clean(row.definition),
      keyConfigured: !!process.env[row.definition.keyEnv],
      revisions: versions.map((version) => clean(version)),
    };
  },
});

const persona = (row: Persona) => ({
  id: row._id,
  revision: row.revision,
  name: row.name,
  enabled: row.enabled,
  archived: row.archived,
  updatedAt: iso(row.updatedAt),
});
export const personaSearch = define({
  description: "Personas with revision and availability.",
  inputs: { cursor: "optional nextCursor" },
  input: pageOnly,
  async run(context, input: z.infer<typeof pageOnly>) {
    const after = context.readCursor({}, input.cursor);
    const rows = await context.db
      .collection<Persona>("personas")
      .find(after ? { _id: { $gt: after.id } } : {}, options(context))
      .sort({ _id: 1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    return paged(
      context,
      {},
      rows,
      (row) => ({ value: 0, id: row._id }),
      persona,
    );
  },
});
export const personaGet = define({
  description:
    "One persona's fields (instructions, pricing, limits) and recent revisions.",
  inputs: { id: "exact persona ID" },
  input: idOnly,
  async run(context, input: z.infer<typeof idOnly>) {
    const row = await context.db
      .collection<Persona>("personas")
      .findOne({ _id: input.id }, options(context));
    if (!row) throw missing();
    context.target({ resource: "persona", id: row._id });
    const versions = await context.db
      .collection<Document & { _id: string }>("personaVersions")
      .find(
        { personaId: row._id },
        {
          ...options(context),
          projection: { revision: 1, updatedAt: 1, actorUid: 1, reason: 1 },
        },
      )
      .sort({ revision: -1 })
      .limit(25)
      .toArray();
    return {
      ...persona(row),
      fields: clean(row),
      revisions: versions.map((version) => clean(version)),
    };
  },
});

export const settingsGet = define({
  description:
    "Stored Base settings (models, pricing, limits) and persona completion settings, read without initializing defaults.",
  inputs: {},
  input: z.strictObject({}),
  async run(context) {
    const base = await storedSettings(context);
    const completion = await context.db
      .collection<Document & { _id: string }>("personaCompletionSettings")
      .findOne({ _id: "shared" }, options(context));
    return {
      base: { ...base, settings: clean(base.settings) },
      personaCompletion: completion
        ? {
            stored: true,
            revision: completion.revision ?? null,
            settings: clean(completion.settings),
          }
        : { stored: false },
    };
  },
});

const reportKinds = ["runtime", "audit", "diagnostic-access"] as const;
const searchInput = z.strictObject({
  kind: z.enum(reportKinds),
  event: z.string().max(80).optional(),
  severity: z.enum(["info", "warn", "error"]).optional(),
  requestId: z.uuid().optional(),
  actorUid: uidInput.optional(),
  targetUid: uidInput.optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
  cursor: cursorInput,
});
const runtimeRow = (item: StoredRuntimeRecord) => ({
  id: item._id,
  timestamp: iso(item.timestamp),
  event: item.event,
  severity: item.severity,
  status: item.status,
  durationMs: item.durationMs,
  requestId: item.requestId,
});
const auditRow = (item: AuditEntry) => ({
  id: item._id,
  timestamp: iso(item.timestamp),
  event: item.event,
  actorUid: item.actorUid,
  targetUid: item.targetUid,
  reason: item.reason,
  before: clean(item.before ?? null),
  after: clean(item.after ?? null),
  grant: item.grant
    ? {
        id: item.grant.id,
        capabilities: item.grant.capabilities,
        expiresAt: iso(item.grant.expiresAt),
      }
    : null,
});
const accessRow = (item: AccessRecord) => ({
  id: item._id,
  timestamp: iso(item.timestamp),
  requestId: item.requestId,
  operatorUid: item.operatorUid,
  grantId: item.grantId,
  capability: item.capability,
  outcome: item.outcome,
  status: item.status,
  targets: item.targets,
});
export const reportsSearch = define({
  description:
    "Runtime records, audit records or diagnostic access records by bounded criteria, newest first.",
  inputs: {
    kind: "runtime, audit or diagnostic-access",
    event: "optional exact event (runtime/audit)",
    severity: "optional info, warn or error (runtime)",
    requestId: "optional request UUID (runtime, diagnostic-access)",
    actorUid: "optional actor/operator UID (audit, diagnostic-access)",
    targetUid: "optional target account UID (audit, diagnostic-access)",
    from: "optional YYYY-MM-DD",
    to: "optional YYYY-MM-DD",
    cursor: "optional nextCursor",
  },
  input: searchInput,
  async run(context, input: z.infer<typeof searchInput>) {
    const { cursor, ...criteria } = input;
    const range = dateRange(input.from, input.to);
    if (!range) throw new AppError("INVALID_INPUT", "Invalid date range.");
    if (
      input.event &&
      !(
        input.kind === "audit"
          ? (auditEvents as readonly string[])
          : input.kind === "runtime"
            ? (runtimeEvents as readonly string[])
            : []
      ).includes(input.event)
    )
      throw new AppError("INVALID_INPUT", "Unknown event for this kind.");
    const after = context.readCursor(criteria, cursor);
    const timestamp = Object.keys(range).length ? { timestamp: range } : {};
    const query = (extra: Record<string, unknown>) => ({
      ...timestamp,
      ...extra,
      ...before("timestamp", after),
    });
    const fetch = <T extends Document>(
      name: string,
      filter: Record<string, unknown>,
    ) =>
      context.db
        .collection<T>(name)
        .find(filter as Filter<T>, options(context))
        .sort({ timestamp: -1, _id: -1 })
        .limit(PAGE_SIZE + 1)
        .toArray();
    const position = (row: { timestamp: Date; _id: string }) => ({
      value: row.timestamp.toISOString(),
      id: row._id,
    });
    if (input.kind === "runtime") {
      const rows = await fetch<StoredRuntimeRecord>(
        "runtimeLogs",
        query({
          ...(input.event ? { event: input.event } : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.requestId
            ? { requestId: input.requestId.toLowerCase() }
            : {}),
        }),
      );
      return paged(context, criteria, rows, position, runtimeRow);
    }
    if (input.targetUid)
      context.target({ resource: "reports", accountUid: input.targetUid });
    if (input.kind === "audit") {
      const rows = await fetch<AuditEntry>(
        "auditEvents",
        query({
          ...(input.event ? { event: input.event } : {}),
          ...(input.actorUid ? { actorUid: input.actorUid } : {}),
          ...(input.targetUid ? { targetUid: input.targetUid } : {}),
        }),
      );
      return paged(context, criteria, rows, position, auditRow);
    }
    const rows = await fetch<AccessRecord>(
      accessRecords,
      query({
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.actorUid ? { operatorUid: input.actorUid } : {}),
        ...(input.targetUid ? { "targets.accountUid": input.targetUid } : {}),
      }),
    );
    return paged(context, criteria, rows, position, accessRow);
  },
});
const getInput = z.strictObject({ kind: z.enum(reportKinds), id: idInput });
export const reportsGet = define({
  description: "One runtime, audit or diagnostic access record by exact ID.",
  inputs: {
    kind: "runtime, audit or diagnostic-access",
    id: "exact record ID",
  },
  input: getInput,
  async run(context, input: z.infer<typeof getInput>) {
    const name =
      input.kind === "runtime"
        ? "runtimeLogs"
        : input.kind === "audit"
          ? "auditEvents"
          : accessRecords;
    const row = await context.db
      .collection<Document & { _id: string }>(name)
      .findOne({ _id: input.id }, options(context));
    if (!row) throw missing();
    return input.kind === "runtime"
      ? runtimeRow(row as unknown as StoredRuntimeRecord)
      : input.kind === "audit"
        ? auditRow(row as unknown as AuditEntry)
        : accessRow(row as unknown as AccessRecord);
  },
});
