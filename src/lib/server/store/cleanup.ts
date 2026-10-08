import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Filter, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { cleanupOptionsSchema } from "@/lib/contracts/operations";
import type { CreditActor } from "./credit-types";
import { accessTransaction, type AuditEntry } from "./access";
import { aiJobs, type AiJob } from "../ai/jobs";
import { aiFiles } from "../ai/files";
import { assetStages } from "../workspaces/asset-storage";
import {
  deletableWorkspace,
  deleteArchivedWorkspace,
} from "../workspaces/lifecycle";
import type { Workspace } from "../workspaces/store";

type CleanupReport = {
  _id: string;
  actorUid: string;
  state: "preview" | "completed";
  createdAt: Date;
  expiresAt: Date;
  cutoff: Date;
  targets: {
    kind: "job" | "file" | "stage" | "workspace";
    id: string;
    updatedAt: Date;
    revision?: number;
    assets?: number;
    events?: number;
  }[];
  approvedStages?: string[];
  changed: number;
  skipped: number;
};
const reports = (db: Db) => db.collection<CleanupReport>("cleanupReports");
async function cleanupReportView(
  db: Db,
  report: CleanupReport,
  session?: ClientSession,
) {
  const stages = report.approvedStages?.length
    ? await assetStages(db)
        .find(
          { _id: { $in: report.approvedStages } },
          {
            session,
            projection: { state: 1, deleteFailed: 1 },
          },
        )
        .toArray()
    : [];
  return {
    id: report._id,
    state: report.state,
    createdAt: report.createdAt.toISOString(),
    expiresAt: report.expiresAt.toISOString(),
    cutoff: report.cutoff.toISOString(),
    jobs: report.targets.filter((t) => t.kind === "job").length,
    files: report.targets.filter((t) => t.kind === "file").length,
    abandonedUploads: report.targets.filter((t) => t.kind === "stage").length,
    workspaces: report.targets.filter((t) => t.kind === "workspace").length,
    workspaceAssets: report.targets.reduce(
      (sum, t) => sum + (t.assets ?? 0),
      0,
    ),
    workspaceEvents: report.targets.reduce(
      (sum, t) => sum + (t.events ?? 0),
      0,
    ),
    storagePending: stages.filter((s) => s.state === "deleting").length,
    storageFailed: stages.filter(
      (s) => s.state === "deleting" && s.deleteFailed,
    ).length,
    storageDeleted: stages.filter((s) => s.state === "deleted").length,
    changed: report.changed,
    skipped: report.skipped,
    ids: report.targets.map((t) => `${t.kind}:${t.id}`),
  };
}
function eligibleJobs(cutoff: Date, now: Date): Filter<AiJob> {
  return {
    cleanedAt: { $exists: false },
    updatedAt: { $lt: cutoff },
    leaseUntil: { $lte: now },
    $or: [
      { status: { $in: ["succeeded", "failed"] } },
      { status: "cancelled", "execution.status": "stopped" },
    ],
  };
}
export async function previewCleanup(
  db: Db,
  actor: CreditActor,
  input: unknown,
  now = new Date(),
) {
  const options = cleanupOptionsSchema.parse(input);
  return accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const cutoff = new Date(now.getTime() - options.olderThanDays * 86400000);
      const targets: CleanupReport["targets"] = [];
      if (options.scope === "jobs" || options.scope === "both") {
        const jobs = await aiJobs(db)
          .find(eligibleJobs(cutoff, now), {
            session,
            projection: { _id: 1, updatedAt: 1 },
          })
          .sort({ updatedAt: 1, _id: 1 })
          .limit(options.limit)
          .toArray();
        targets.push(
          ...jobs.map((job) => ({
            kind: "job" as const,
            id: job._id,
            updatedAt: job.updatedAt,
          })),
        );
      }
      if (
        (options.scope === "failed-files" || options.scope === "both") &&
        targets.length < options.limit
      ) {
        const files = await aiFiles(db)
          .find(
            {
              status: "failed",
              cleanedAt: { $exists: false },
              updatedAt: { $lt: cutoff },
            },
            { session, projection: { _id: 1, updatedAt: 1 } },
          )
          .sort({ updatedAt: 1, _id: 1 })
          .limit(options.limit - targets.length)
          .toArray();
        targets.push(
          ...files.map((file) => ({
            kind: "file" as const,
            id: file._id,
            updatedAt: file.updatedAt,
          })),
        );
      }
      if (options.scope === "abandoned-uploads") {
        const stages = await assetStages(db)
          .find(
            {
              state: { $in: ["uploading", "ready"] },
              createdAt: { $lt: cutoff },
            },
            { session, projection: { _id: 1, createdAt: 1 } },
          )
          .sort({ createdAt: 1, _id: 1 })
          .limit(options.limit)
          .toArray();
        targets.push(
          ...stages.map((stage) => ({
            kind: "stage" as const,
            id: stage._id,
            updatedAt: stage.createdAt,
          })),
        );
      }
      if (options.scope === "archived-workspaces") {
        const candidates = await db
          .collection<Workspace>("workspaces")
          .find(
            {
              archivedAt: { $type: "string", $lt: cutoff.toISOString() },
              paused: true,
            },
            { session },
          )
          .sort({ archivedAt: 1, _id: 1 })
          .limit(100)
          .toArray();
        for (const workspace of candidates) {
          if (targets.length >= Math.min(10, options.limit)) break;
          if (!(await deletableWorkspace(db, workspace, session, now)))
            continue;
          const owner = { uid: workspace.uid, workspaceId: workspace.id };
          targets.push({
            kind: "workspace",
            id: workspace.id,
            updatedAt: new Date(workspace.updatedAt),
            revision: workspace.revision,
            assets: await db
              .collection("workspaceAssets")
              .countDocuments(owner, { session }),
            events: await db
              .collection("workspaceEvents")
              .countDocuments(owner, { session }),
          });
        }
      }
      const report: CleanupReport = {
        _id: randomUUID(),
        actorUid: actor.uid,
        state: "preview",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 900000),
        cutoff,
        targets,
        changed: 0,
        skipped: 0,
      };
      await reports(db).insertOne(report, { session });
      return cleanupReportView(db, report, session);
    },
    actor.authTime,
  );
}
export async function executeCleanup(
  db: Db,
  actor: CreditActor,
  reportId: string,
  reason: string,
  now = new Date(),
) {
  if (reason.trim().length < 10 || reason.length > 500)
    throw new AppError("INVALID_INPUT", "Provide a cleanup explanation.");
  return accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const report = await reports(db).findOne(
        { _id: reportId, actorUid: actor.uid },
        { session },
      );
      if (!report)
        throw new AppError("NOT_FOUND", "Cleanup preview not found.", 404);
      if (report.state === "completed")
        return cleanupReportView(db, report, session);
      if (report.expiresAt <= now)
        throw new AppError(
          "PREVIEW_EXPIRED",
          "Preview expired. Generate a new report.",
          409,
        );
      let changed = 0;
      report.approvedStages = [];
      for (const target of report.targets) {
        if (target.kind === "job") {
          const result = await aiJobs(db).updateOne(
            {
              $and: [
                eligibleJobs(report.cutoff, now),
                { _id: target.id, updatedAt: target.updatedAt },
              ],
            },
            {
              $set: { inputs: {}, source: null, cleanedAt: now },
              $unset: { "execution.outputs": "" },
            },
            { session },
          );
          changed += result.modifiedCount;
        } else if (target.kind === "file") {
          const result = await aiFiles(db).updateOne(
            {
              _id: target.id,
              updatedAt: target.updatedAt,
              status: "failed",
              cleanedAt: { $exists: false },
            },
            { $set: { name: "Removed", cleanedAt: now } },
            { session },
          );
          changed += result.modifiedCount;
        } else if (target.kind === "stage") {
          const result = await assetStages(db).updateOne(
            {
              _id: target.id,
              createdAt: target.updatedAt,
              state: { $in: ["uploading", "ready"] },
            },
            { $set: { state: "deleting", nextDeleteAt: now } },
            { session },
          );
          changed += result.modifiedCount;
          if (result.modifiedCount) report.approvedStages.push(target.id);
        } else if (target.revision !== undefined) {
          const stages = await deleteArchivedWorkspace(
            db,
            target.id,
            target.revision,
            report.cutoff,
            session,
            now,
          );
          if (stages) {
            changed++;
            report.approvedStages.push(...stages);
          }
        }
      }
      report.state = "completed";
      report.changed = changed;
      report.skipped = report.targets.length - changed;
      await reports(db).replaceOne({ _id: report._id }, report, { session });
      await db.collection<AuditEntry>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "ai-cleanup",
          actorUid: actor.uid,
          targetUid: "cleanup",
          reason: `${report._id}: ${reason.trim()}`,
          timestamp: now,
        },
        { session },
      );
      return cleanupReportView(db, report, session);
    },
    actor.authTime,
  );
}
export async function recentCleanupReports(db: Db) {
  const recent = await reports(db)
    .find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();
  return Promise.all(recent.map((report) => cleanupReportView(db, report)));
}
