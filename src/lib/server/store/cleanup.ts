import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Filter } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { cleanupOptionsSchema } from "@/lib/contracts/operations";
import type { CreditActor } from "./credit-types";
import { accessTransaction, type AuditEntry } from "./access";
import { aiJobs, type AiJob } from "../ai/jobs";
import { aiFiles } from "../ai/files";

type CleanupReport = {
  _id: string;
  actorUid: string;
  state: "preview" | "completed";
  createdAt: Date;
  expiresAt: Date;
  cutoff: Date;
  targets: { kind: "job" | "file"; id: string; updatedAt: Date }[];
  changed: number;
  skipped: number;
};
const reports = (db: Db) => db.collection<CleanupReport>("cleanupReports");
export function cleanupReportView(report: CleanupReport) {
  return {
    id: report._id,
    state: report.state,
    createdAt: report.createdAt.toISOString(),
    expiresAt: report.expiresAt.toISOString(),
    cutoff: report.cutoff.toISOString(),
    jobs: report.targets.filter((t) => t.kind === "job").length,
    files: report.targets.filter((t) => t.kind === "file").length,
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
      if (options.scope !== "failed-files") {
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
      if (options.scope !== "jobs" && targets.length < options.limit) {
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
      return cleanupReportView(report);
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
      if (report.state === "completed") return cleanupReportView(report);
      if (report.expiresAt <= now)
        throw new AppError(
          "PREVIEW_EXPIRED",
          "Preview expired. Generate a new report.",
          409,
        );
      let changed = 0;
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
        } else {
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
      return cleanupReportView(report);
    },
    actor.authTime,
  );
}
export async function recentCleanupReports(db: Db) {
  return (
    await reports(db).find({}).sort({ createdAt: -1 }).limit(20).toArray()
  ).map(cleanupReportView);
}
