import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { assetByteLimit, parseAssetConfig } from "@/lib/config/assets";
import {
  exportStartSchema,
  exportCancelSchema,
  exportJobSchema,
  type ExportJobView,
  type ExportSnapshot,
} from "@/lib/contracts/export";
import { fingerprint } from "../ai/jobs";
import { ownedWorkspace, type Workspace } from "./store";
import { workspaceTransaction, type WorkspaceActor } from "./transaction";
import { captureExportSnapshot } from "./export-snapshot";
import { exportRenderers, type ExportRenderer } from "./export-renderers";
import { privateAssetStore } from "./asset-storage";
import { assetRecord } from "./assets";

export type ExportJob = Omit<
  ExportJobView,
  "id" | "createdAt" | "updatedAt"
> & {
  _id: string;
  uid: string;
  authTime: number;
  snapshot: ExportSnapshot;
  resultId: string;
  createdAt: Date;
  updatedAt: Date;
  nextAttemptAt: Date;
  attempts: number;
  lease: string | null;
  leaseUntil: Date;
};
type Operation = { _id: string; hash: string; jobId: string };
export const exportJobs = (db: Db) =>
  db.collection<ExportJob>("workspaceExports");
export async function createExportIndexes(db: Db) {
  await exportJobs(db).createIndex({
    status: 1,
    nextAttemptAt: 1,
    leaseUntil: 1,
  });
  await exportJobs(db).createIndex({ uid: 1, workspaceId: 1, createdAt: -1 });
}
const conflict = (message: string) =>
  new AppError("EXPORT_CONFLICT", message, 409);
export function exportView(job: ExportJob): ExportJobView {
  return exportJobSchema.parse({
    id: job._id,
    workspaceId: job.workspaceId,
    revision: job.revision,
    format: job.format,
    renderer: job.renderer,
    sources: job.sources,
    status: job.status,
    progress: job.progress,
    error: job.error,
    assetId: job.assetId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  });
}
export async function listExports(db: Db, uid: string, workspaceId: string) {
  await ownedWorkspace(db, uid, workspaceId);
  const jobs = await exportJobs(db)
    .find({ uid, workspaceId }, { projection: { snapshot: 0 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(20)
    .toArray();
  return { jobs: jobs.map(exportView) };
}
export async function startExport(
  db: Db,
  actor: WorkspaceActor,
  workspaceId: string,
  input: unknown,
) {
  const request = exportStartSchema.parse(input);
  if (request.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Sign in again before exporting.",
      409,
    );
  let renderer: ExportRenderer;
  try {
    renderer = exportRenderers.get(
      request.renderer.type,
      request.renderer.version,
    );
  } catch {
    throw conflict("This export renderer or version is unavailable.");
  }
  if (renderer.format !== request.format)
    throw conflict("Choose a renderer for this export format.");
  const operationId = fingerprint(["export", actor.uid, request.key]);
  const hash = fingerprint([workspaceId, request]);
  const jobId = randomUUID(),
    resultId = randomUUID();
  return workspaceTransaction(db, actor, async (session) => {
    const workspace = await ownedWorkspace(db, actor.uid, workspaceId, session);
    const prior = await db
      .collection<Operation>("workspaceExportOperations")
      .findOne({ _id: operationId }, { session });
    if (prior) {
      if (prior.hash !== hash)
        throw conflict("This export key was used for different input.");
      const job = await exportJobs(db).findOne(
        { _id: prior.jobId, uid: actor.uid },
        { session },
      );
      if (!job) throw conflict("This export was removed. Start a new export.");
      return exportView(job);
    }
    if (workspace.revision !== request.revision)
      throw conflict("This workspace changed. Refresh before exporting.");
    if (workspace.archivedAt || workspace.paused)
      throw conflict(
        "Restore and resume the workspace before starting an export.",
      );
    if (workspace.assets.length >= 50)
      throw conflict("This workspace reached its 50-asset limit.");
    if (
      (await exportJobs(db).countDocuments(
        { uid: actor.uid, workspaceId },
        { session },
      )) >= 20
    )
      throw conflict("This workspace reached its 20-export limit.");
    if (
      (await exportJobs(db).countDocuments(
        { uid: actor.uid, status: { $in: ["queued", "rendering"] } },
        { session },
      )) >= 3
    )
      throw conflict(
        "Wait for or cancel an active export before starting another.",
      );
    const now = new Date();
    const snapshot = await captureExportSnapshot(
      db,
      workspace,
      request.sources,
      session,
      now,
    );
    const job: ExportJob = {
      _id: jobId,
      uid: actor.uid,
      authTime: actor.authTime,
      workspaceId,
      revision: 0,
      format: request.format,
      renderer: request.renderer,
      sources: request.sources,
      snapshot,
      resultId,
      status: "queued",
      progress: 0,
      error: null,
      assetId: null,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
      attempts: 0,
      lease: null,
      leaseUntil: new Date(0),
    };
    await exportJobs(db).insertOne(job, { session });
    await db
      .collection<Operation>("workspaceExportOperations")
      .insertOne({ _id: operationId, hash, jobId }, { session });
    return exportView(job);
  });
}
export async function cancelExport(
  db: Db,
  actor: WorkspaceActor,
  workspaceId: string,
  id: string,
  input: unknown,
) {
  const request = exportCancelSchema.parse(input);
  if (request.expectedUid !== actor.uid)
    throw conflict("Your account changed. Sign in again.");
  return workspaceTransaction(db, actor, async (session) => {
    await ownedWorkspace(db, actor.uid, workspaceId, session);
    const job = await exportJobs(db).findOne(
      { _id: id, uid: actor.uid, workspaceId },
      { session },
    );
    if (!job) throw new AppError("NOT_FOUND", "Export not found.", 404);
    if (job.status === "cancelled") return exportView(job);
    if (job.revision !== request.revision)
      throw conflict("The export changed. Refresh before cancelling.");
    if (!["queued", "rendering"].includes(job.status))
      throw conflict("This export has already finished.");
    job.status = "cancelled";
    job.updatedAt = new Date();
    job.revision++;
    // A running worker retains its lease until it acknowledges cancellation or
    // expires. Archive/cleanup cannot race its outstanding external storage I/O.
    await exportJobs(db).replaceOne({ _id: id }, job, { session });
    return exportView(job);
  });
}

type WorkerOptions = {
  authorize: (uid: string, authTime: number) => Promise<boolean>;
  now?: () => Date;
  renderer?: (job: ExportJob) => ExportRenderer;
  store?: ReturnType<typeof privateAssetStore>;
};
export async function processOneExport(db: Db, options: WorkerOptions) {
  const now = options.now ?? (() => new Date());
  // A crash on the final attempt must become visible instead of leaving a job
  // permanently rendering. Local rendering is replayable; provider calls are absent.
  await exportJobs(db).updateMany(
    { status: "rendering", leaseUntil: { $lte: now() }, attempts: { $gte: 3 } },
    {
      $set: {
        status: "failed",
        error: "Export interrupted repeatedly. Start a new export.",
        lease: null,
        leaseUntil: new Date(0),
        updatedAt: now(),
      },
      $inc: { revision: 1 },
    },
  );
  const token = randomUUID();
  const job = await exportJobs(db).findOneAndUpdate(
    {
      status: { $in: ["queued", "rendering"] },
      leaseUntil: { $lte: now() },
      nextAttemptAt: { $lte: now() },
      attempts: { $lt: 3 },
    },
    {
      $set: {
        status: "rendering",
        lease: token,
        leaseUntil: new Date(now().getTime() + 180000),
        progress: 1,
        updatedAt: now(),
      },
      $inc: { attempts: 1, revision: 1 },
    },
    { sort: { createdAt: 1, _id: 1 }, returnDocument: "after" },
  );
  if (!job) return false;
  const actor = { uid: job.uid, authTime: job.authTime };
  const ownedLease = () => ({
    _id: job._id,
    status: "rendering" as const,
    lease: token,
    leaseUntil: { $gt: now() },
  });
  const store = options.store ?? privateAssetStore(db);
  const signal = AbortSignal.timeout(120000);
  const progress = async (percent: number) => {
    signal.throwIfAborted();
    const updated = await exportJobs(db).updateOne(ownedLease(), {
      $set: {
        progress: Math.min(95, Math.max(1, Math.round(percent))),
        updatedAt: now(),
      },
    });
    if (!updated.matchedCount)
      throw conflict("Export cancelled or worker lease expired.");
  };
  try {
    if (!(await options.authorize(job.uid, job.authTime)))
      throw new AppError("FORBIDDEN", "Account access changed.", 403);
    await workspaceTransaction(db, actor, async (session) => {
      const workspace = await ownedWorkspace(
        db,
        job.uid,
        job.workspaceId,
        session,
      );
      if (workspace.archivedAt)
        throw conflict("Restore the workspace before exporting.");
      if (!(await exportJobs(db).findOne(ownedLease(), { session })))
        throw conflict("Export is no longer active.");
    });
    const renderer =
      options.renderer?.(job) ??
      exportRenderers.get(job.renderer.type, job.renderer.version);
    if (renderer.format !== job.format)
      throw conflict("Export renderer configuration changed.");
    const bytes = await renderer.render({
      snapshot: job.snapshot,
      signal,
      maxBytes: assetByteLimit(parseAssetConfig(process.env)),
      progress,
      readAsset: async (id) => {
        const asset = await store.get(job.uid, id);
        if (!asset || asset.workspaceId !== job.workspaceId)
          throw conflict("An export image is unavailable.");
        return Buffer.from(asset.base64, "base64");
      },
    });
    await progress(90);
    const prepared = await store.stage(
      assetRecord(
        job.resultId,
        job.uid,
        job.workspaceId,
        `export-${job._id}.${job.format}`,
        bytes,
        renderer.mime,
      ),
      actor,
    );
    await progress(95);
    if (!(await options.authorize(job.uid, job.authTime)))
      throw new AppError("FORBIDDEN", "Account access changed.", 403);
    await workspaceTransaction(db, actor, async (session) => {
      if (!(await exportJobs(db).findOne(ownedLease(), { session })))
        throw conflict("Export is no longer active.");
      const workspace = await ownedWorkspace(
        db,
        job.uid,
        job.workspaceId,
        session,
      );
      if (workspace.archivedAt || workspace.assets.length >= 50)
        throw conflict("The workspace cannot accept another export.");
      await store.put(prepared, session);
      workspace.assets.push({
        id: prepared._id,
        name: prepared.name,
        mime: prepared.mime,
        bytes: prepared.bytes,
      });
      workspace.revision++;
      workspace.updatedAt = now().toISOString();
      if (Buffer.byteLength(JSON.stringify(workspace)) > 2 * 1024 * 1024)
        throw conflict("The workspace reached its size limit.");
      await db
        .collection<Workspace>("workspaces")
        .replaceOne({ _id: job.workspaceId, uid: job.uid }, workspace, {
          session,
        });
      const published = await exportJobs(db).updateOne(
        ownedLease(),
        {
          $set: {
            status: "succeeded",
            progress: 100,
            assetId: prepared._id,
            error: null,
            updatedAt: now(),
            lease: null,
            leaseUntil: new Date(0),
          },
          $inc: { revision: 1 },
        },
        { session },
      );
      if (!published.matchedCount)
        throw conflict("Export lease expired before publication.");
    });
  } catch (error) {
    const forbidden = error instanceof AppError && error.code === "FORBIDDEN";
    const permanent =
      error instanceof AppError &&
      [
        "EXPORT_CONFLICT",
        "EXPORT_ASSET_INVALID",
        "EXPORT_TOO_LARGE",
        "EXPORT_FONT_UNSUPPORTED",
        "ASSET_TOO_LARGE",
        "NOT_FOUND",
      ].includes(error.code);
    const terminal = forbidden || permanent || job.attempts >= 3;
    await exportJobs(db).updateOne(ownedLease(), {
      $set: {
        status: forbidden ? "cancelled" : terminal ? "failed" : "queued",
        error: forbidden
          ? "Account access changed."
          : permanent
            ? error.message
            : terminal
              ? "Export failed after three attempts. Start a new export."
              : "Export interrupted; the worker will retry.",
        updatedAt: now(),
        nextAttemptAt: new Date(now().getTime() + 10000 * job.attempts),
        lease: null,
        leaseUntil: new Date(0),
      },
      $inc: { revision: 1 },
    });
  } finally {
    await exportJobs(db).updateOne(
      { _id: job._id, lease: token, status: "cancelled" },
      { $set: { lease: null, leaseUntil: new Date(0) } },
    );
  }
  return true;
}
