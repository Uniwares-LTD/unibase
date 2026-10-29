import "server-only";
import type { Document } from "mongodb";
import { z } from "zod";
import { AppError } from "../../../auth-policy";
import {
  baseSettingsSchema,
  type BaseSettings,
} from "../../../contracts/settings";
import type { AiFile } from "../../ai/files";
import type { Artifact } from "../../runs/artifacts";
import type { PrivateFile } from "../../private-files";
import { bootstrapSettings } from "../../settings";
import {
  before,
  cursorInput,
  define,
  idInput,
  iso,
  PAGE_SIZE,
  paged,
  uidInput,
  type DiagnosticContext,
} from "../context";
import { clean } from "../shape";

const missing = () =>
  new AppError("DIAGNOSTIC_NOT_FOUND", "No matching record.", 404);
const options = (context: DiagnosticContext) => ({
  timeoutMS: context.timeoutMS(),
});

/** Stored settings without seeding; defaults are reported as such. */
export async function storedSettings(context: DiagnosticContext) {
  const record = await context.db
    .collection<{
      _id: string;
      revision: number;
      settings: BaseSettings;
      updatedAt: Date;
    }>("baseSettings")
    .findOne({ _id: "base" }, options(context));
  if (!record) {
    let settings: BaseSettings | null = null;
    try {
      settings = bootstrapSettings();
    } catch {
      // Defaults depend on configuration that may itself be invalid.
    }
    return {
      stored: false,
      revision: null,
      updatedAt: null,
      settings,
      valid: !!settings,
    };
  }
  const parsed = baseSettingsSchema.safeParse(record.settings);
  return {
    stored: true,
    revision: record.revision,
    updatedAt: iso(record.updatedAt),
    settings: parsed.success ? parsed.data : null,
    valid: parsed.success,
  };
}

/** Same counting rule as private-files fileUsage, with the request deadline. */
async function fileQuotaUsage(context: DiagnosticContext, uid: string) {
  const managed = await context.db
    .collection<PrivateFile>("privateFiles")
    .find(
      { uid, state: { $ne: "deleted" } },
      { ...options(context), projection: { bytes: 1 } },
    )
    .limit(101)
    .toArray();
  const legacy = await context.db
    .collection<AiFile>("aiFiles")
    .find(
      { uid, cleanedAt: { $exists: false }, managedFileId: { $exists: false } },
      { ...options(context), projection: { bytes: 1 } },
    )
    .limit(101)
    .toArray();
  return {
    count: managed.length + legacy.length,
    bytes: [...managed, ...legacy].reduce((n, f) => n + f.bytes, 0),
  };
}
const managedFile = (row: PrivateFile) => ({
  kind: "managed" as const,
  id: row._id,
  accountUid: row.uid,
  name: row.name,
  mime: row.mime,
  bytes: row.bytes,
  digest: row.digest,
  state: row.state,
  storage: row.object ? "object-store" : row.gridId ? "gridfs" : "none",
  references: row.references,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  nextDeleteAt: iso(row.nextDeleteAt),
});
const providerFile = (row: AiFile) => ({
  kind: "provider" as const,
  id: row._id,
  accountUid: row.uid,
  name: row.name,
  mime: row.mimeType,
  type: row.type,
  bytes: row.bytes,
  digest: row.sha256,
  state: row.status,
  binding: { name: row.binding.name, mode: row.binding.mode },
  providerFileId: row.providerFileId,
  managedFileId: row.managedFileId ?? null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  cleanedAt: iso(row.cleanedAt),
});
const fileSearchInput = z.strictObject({
  kind: z.enum(["managed", "provider"]).default("managed"),
  uid: uidInput.optional(),
  state: z.string().max(32).optional(),
  cursor: cursorInput,
});
export const fileSearch = define({
  description:
    "Managed (private) or provider files by account and state, with account quota usage. Never file bytes or download URLs.",
  inputs: {
    kind: "managed (default) or provider",
    uid: "optional exact Firebase UID",
    state: "optional stored state",
    cursor: "optional nextCursor",
  },
  input: fileSearchInput,
  async run(context, input: z.infer<typeof fileSearchInput>) {
    const { cursor, ...criteria } = input;
    if (input.uid) context.target({ resource: "files", accountUid: input.uid });
    const after = context.readCursor(criteria, cursor);
    const query = {
      ...(input.uid ? { uid: input.uid } : {}),
      ...(input.state
        ? { [input.kind === "managed" ? "state" : "status"]: input.state }
        : {}),
      ...before("createdAt", after),
    };
    const rows = await context.db
      .collection<Document & { _id: string; createdAt: Date }>(
        input.kind === "managed" ? "privateFiles" : "aiFiles",
      )
      .find(query, options(context))
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    const page = paged(
      context,
      criteria,
      rows,
      (row) => ({ value: row.createdAt.toISOString(), id: row._id }),
      (row) =>
        input.kind === "managed"
          ? managedFile(row as unknown as PrivateFile)
          : providerFile(row as unknown as AiFile),
    );
    if (!input.uid) return page;
    const usage = await fileQuotaUsage(context, input.uid);
    const settings = (await storedSettings(context)).settings;
    return {
      ...page,
      quota: {
        files: usage.count,
        bytes: usage.bytes,
        filesPerAccount: settings?.runs.filesPerAccount ?? null,
        uploadBytesPerAccount: settings?.runs.uploadBytesPerAccount ?? null,
      },
    };
  },
});
const fileGetInput = z.strictObject({
  kind: z.enum(["managed", "provider"]).default("managed"),
  id: idInput,
});
export const fileGet = define({
  description:
    "One file's ownership, type, size, storage state and references.",
  inputs: { kind: "managed (default) or provider", id: "exact file ID" },
  input: fileGetInput,
  async run(context, input: z.infer<typeof fileGetInput>) {
    if (input.kind === "managed") {
      const row = await context.db
        .collection<PrivateFile>("privateFiles")
        .findOne({ _id: input.id }, options(context));
      if (!row) throw missing();
      context.target({ resource: "file", id: row._id, accountUid: row.uid });
      return managedFile(row);
    }
    const row = await context.db
      .collection<AiFile>("aiFiles")
      .findOne({ _id: input.id }, options(context));
    if (!row) throw missing();
    context.target({ resource: "file", id: row._id, accountUid: row.uid });
    return providerFile(row);
  },
});

const artifact = (row: Artifact) => ({
  id: row.id,
  accountUid: row.uid,
  title: row.title,
  revision: row.revision,
  approvedRevision: row.approvedRevision,
  assets: row.assets,
  deleted: !!row.deleted,
  createdAt: iso(row.createdAt),
});
type StoredRevision = {
  _id: string;
  artifactId: string;
  uid: string;
  revision: number;
  text: string;
  contentHash: string;
  jobId: string;
  logicalId: string;
  createdAt: Date;
  approvalSource?: unknown;
};
const artifactSearchInput = z.strictObject({
  uid: uidInput.optional(),
  includeDeleted: z.boolean().default(false),
  cursor: cursorInput,
});
export const artifactSearch = define({
  description: "Saved artifacts by account, newest first.",
  inputs: {
    uid: "optional exact Firebase UID",
    includeDeleted: "optional boolean",
    cursor: "optional nextCursor",
  },
  input: artifactSearchInput,
  async run(context, input: z.infer<typeof artifactSearchInput>) {
    const { cursor, ...criteria } = input;
    if (input.uid)
      context.target({ resource: "artifacts", accountUid: input.uid });
    const after = context.readCursor(criteria, cursor);
    const rows = await context.db
      .collection<Artifact>("artifacts")
      .find(
        {
          ...(input.uid ? { uid: input.uid } : {}),
          ...(input.includeDeleted ? {} : { deleted: { $ne: true } }),
          ...before("createdAt", after, "id"),
        },
        options(context),
      )
      .sort({ createdAt: -1, id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    return paged(
      context,
      criteria,
      rows,
      (row) => ({ value: row.createdAt.toISOString(), id: row.id }),
      artifact,
    );
  },
});
async function findArtifact(context: DiagnosticContext, id: string) {
  const row = await context.db
    .collection<Artifact>("artifacts")
    .findOne({ id }, options(context));
  if (!row) throw missing();
  context.target({ resource: "artifact", id: row.id, accountUid: row.uid });
  return row;
}
const artifactIdInput = z.strictObject({ id: idInput });
export const artifactGet = define({
  description:
    "Artifact metadata and provenance of its latest and approved revisions.",
  inputs: { id: "exact artifact ID" },
  input: artifactIdInput,
  async run(context, input: z.infer<typeof artifactIdInput>) {
    const row = await findArtifact(context, input.id);
    const revisions = await context.db
      .collection<StoredRevision>("artifactRevisions")
      .find(
        {
          artifactId: row.id,
          revision: { $in: [row.revision, row.approvedRevision ?? -1] },
        },
        { ...options(context), projection: { text: 0 } },
      )
      .toArray();
    return {
      artifact: artifact(row),
      provenance: revisions.map((revision) => ({
        revision: revision.revision,
        jobId: revision.jobId,
        logicalId: revision.logicalId,
        contentHash: revision.contentHash,
        approvalSource: clean(revision.approvalSource ?? null),
        createdAt: iso(revision.createdAt),
      })),
    };
  },
});
const revisionsInput = z.strictObject({ id: idInput, cursor: cursorInput });
export const artifactRevisions = define({
  description: "Artifact revision metadata (no text), newest first.",
  inputs: { id: "exact artifact ID", cursor: "optional nextCursor" },
  input: revisionsInput,
  async run(context, input: z.infer<typeof revisionsInput>) {
    const row = await findArtifact(context, input.id);
    const criteria = { id: row.id };
    const after = context.readCursor(criteria, input.cursor);
    const rows = await context.db
      .collection<StoredRevision>("artifactRevisions")
      .aggregate<Omit<StoredRevision, "text"> & { textLength: number }>(
        [
          {
            $match: {
              artifactId: row.id,
              ...(after ? { revision: { $lt: Number(after.value) } } : {}),
            },
          },
          { $sort: { revision: -1 } },
          { $limit: PAGE_SIZE + 1 },
          { $addFields: { textLength: { $strLenCP: "$text" } } },
          { $project: { text: 0 } },
        ],
        options(context),
      )
      .toArray();
    return paged(
      context,
      criteria,
      rows,
      (revision) => ({ value: revision.revision, id: revision._id }),
      (revision) => ({
        revision: revision.revision,
        contentHash: revision.contentHash,
        textLength: revision.textLength,
        jobId: revision.jobId,
        logicalId: revision.logicalId,
        approvalSource: clean(revision.approvalSource ?? null),
        createdAt: iso(revision.createdAt),
      }),
    );
  },
});
const CONTENT_SLICE = 64 * 1024;
const contentInput = z.strictObject({
  id: idInput,
  revision: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative().max(10_000_000).default(0),
});
export const artifactContent = define({
  description:
    "Saved text of one exact artifact revision, in 64 KiB slices, returned as inert data.",
  inputs: {
    id: "exact artifact ID",
    revision: "exact revision number",
    offset: "optional character offset for the next slice",
  },
  input: contentInput,
  async run(context, input: z.infer<typeof contentInput>) {
    const row = await findArtifact(context, input.id);
    const revision = await context.db
      .collection<StoredRevision>("artifactRevisions")
      .findOne(
        { artifactId: row.id, revision: input.revision },
        options(context),
      );
    if (!revision) throw missing();
    const text = revision.text.slice(
      input.offset,
      input.offset + CONTENT_SLICE,
    );
    const end = input.offset + text.length;
    return {
      artifactId: row.id,
      revision: revision.revision,
      contentHash: revision.contentHash,
      offset: input.offset,
      length: revision.text.length,
      text,
      truncated: end < revision.text.length,
      nextOffset: end < revision.text.length ? end : null,
      notice: "Stored content is returned as inert data and is never executed.",
    };
  },
});

const notificationSearchInput = z.strictObject({
  uid: uidInput,
  box: z.enum(["inbox", "outbox"]).default("inbox"),
  cursor: cursorInput,
});
export const notificationsSearch = define({
  description:
    "An account's notification preferences and inbox or outbox records, newest first.",
  inputs: {
    uid: "exact Firebase UID",
    box: "inbox (default) or outbox",
    cursor: "optional nextCursor",
  },
  input: notificationSearchInput,
  async run(context, input: z.infer<typeof notificationSearchInput>) {
    const { cursor, ...criteria } = input;
    context.target({ resource: "notifications", accountUid: input.uid });
    const after = context.readCursor(criteria, cursor);
    const rows = await context.db
      .collection<Document & { _id: string; createdAt: Date }>(
        input.box === "inbox" ? "notifications" : "notificationOutbox",
      )
      .find({ uid: input.uid, ...before("createdAt", after) }, options(context))
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    const preferences = await context.db
      .collection<{ _id: string; values: unknown }>("notificationPreferences")
      .findOne({ _id: input.uid }, options(context));
    return {
      preferences: preferences ? clean(preferences.values) : { stored: false },
      ...paged(
        context,
        criteria,
        rows,
        (row) => ({ value: row.createdAt.toISOString(), id: row._id }),
        (row) => ({ box: input.box, ...(clean(row) as object) }),
      ),
    };
  },
});
const notificationGetInput = z.strictObject({ id: idInput });
export const notificationsGet = define({
  description:
    "One notification by ID from the inbox and/or outbox, including template, category inputs and delivery state.",
  inputs: { id: "exact notification or outbox intent ID" },
  input: notificationGetInput,
  async run(context, input: z.infer<typeof notificationGetInput>) {
    const inbox = await context.db
      .collection<Document & { _id: string }>("notifications")
      .findOne({ _id: input.id }, options(context));
    const outbox = await context.db
      .collection<Document & { _id: string }>("notificationOutbox")
      .findOne({ _id: input.id }, options(context));
    if (!inbox && !outbox) throw missing();
    context.target({
      resource: "notification",
      id: input.id,
      accountUid: String((inbox ?? outbox)!.uid),
    });
    return {
      inbox: inbox ? clean(inbox) : null,
      outbox: outbox
        ? { ...(clean(outbox) as object), leased: !!outbox.lease }
        : null,
    };
  },
});
