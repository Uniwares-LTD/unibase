import "server-only";
import { MongoServerError, type Db, type ClientSession } from "mongodb";
import { AppError } from "../auth-policy";
import { domains, jobTarget, type OwnedTarget } from "./domains";
import { aiJobs, fingerprint, type AiJob } from "./ai/jobs";
import { readWallet } from "./store/credits";
import type { ProductResultHandler } from "./runs/artifacts";
type Application = {
  _id: string;
  uid: string;
  jobId: string;
  artifactId?: string;
  target?: OwnedTarget;
  status: "pending" | "applying" | "applied" | "failed";
  nextAttemptAt: Date;
  lease?: string;
  failure?: { phase: string; code: string; at: Date };
};
const safeErrors = new Set([
  "FORBIDDEN",
  "ARTIFACT_NOT_FOUND",
  "ASSET_NOT_FOUND",
  "ASSET_UNAVAILABLE",
  "DOMAIN_UNAVAILABLE",
  "RESULT_ASSETS_UNAVAILABLE",
  "RESULT_TARGET_CHANGED",
  "RESULT_JOB_UNAVAILABLE",
  "RESULT_LEASE_LOST",
]);
function failureCode(error: unknown) {
  if (error instanceof AppError && safeErrors.has(error.code))
    return error.code;
  if (error instanceof MongoServerError && Number.isSafeInteger(error.code))
    return `MONGODB_${error.code}`;
  return "RESULT_APPLICATION_FAILED";
}
export async function queueResultApplication(
  db: Db,
  job: AiJob,
  session: ClientSession,
) {
  const target = jobTarget(job);
  if (!target) return;
  await db.collection<Application>("resultApplications").updateOne(
    { _id: fingerprint([job._id, target.adapter, target.version]) },
    {
      $setOnInsert: {
        uid: job.uid,
        jobId: job._id,
        target,
        ...(target.kind === "artifact" ? { artifactId: target.id } : {}),
        status: "pending",
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, session },
  );
}
export async function processOneResultApplication(
  db: Db,
  apply?: ProductResultHandler,
  registry = domains,
) {
  const records = db.collection<Application>("resultApplications");
  const lease = crypto.randomUUID();
  const intent = await records.findOneAndUpdate(
    {
      status: { $in: ["pending", "applying"] },
      nextAttemptAt: { $lte: new Date() },
    },
    {
      $set: {
        status: "applying",
        lease,
        nextAttemptAt: new Date(Date.now() + 180000),
      },
    },
    { returnDocument: "after" },
  );
  if (!intent) return false;
  let phase = "lookup";
  try {
    const job = await aiJobs(db).findOne({
      _id: intent.jobId,
      uid: intent.uid,
      status: "succeeded",
    });
    if (!job)
      throw new AppError(
        "RESULT_JOB_UNAVAILABLE",
        "Saved Run unavailable.",
        409,
      );
    const target =
      intent.target ??
      (intent.artifactId
        ? {
            adapter: "artifact",
            version: "1",
            kind: "artifact",
            id: intent.artifactId,
          }
        : undefined);
    const expected = jobTarget(job);
    if (!target || !expected || fingerprint(expected) !== fingerprint(target))
      throw new AppError("RESULT_TARGET_CHANGED", "Saved target changed.", 409);
    const adapter = registry.get(target.adapter, target.version);
    phase = "prepare";
    await adapter.prepare?.(db, {
      uid: intent.uid,
      jobId: intent.jobId,
      target,
    });
    phase = "authorize";
    await readWallet(db, intent.uid, {
      actor: { uid: intent.uid, authTime: job.authTime },
      persist: async (session) => {
        phase = "apply";
        const fenced = await records.findOne(
          { _id: intent._id, lease, status: "applying" },
          { session },
        );
        if (!fenced)
          throw new AppError("RESULT_LEASE_LOST", "Save lease changed.", 409);
        const target =
          fenced.target ??
          (fenced.artifactId
            ? {
                adapter: "artifact",
                version: "1",
                kind: "artifact",
                id: fenced.artifactId,
              }
            : undefined);
        if (!target)
          throw new AppError(
            "RESULT_TARGET_CHANGED",
            "Saved target changed.",
            409,
          );
        const current = await aiJobs(db).findOne(
          {
            _id: job._id,
            uid: intent.uid,
            status: "succeeded",
          },
          { session, projection: { "run.target": 1, "run.artifactId": 1 } },
        );
        const expected = current ? jobTarget(current) : undefined;
        if (!expected || fingerprint(expected) !== fingerprint(target))
          throw new AppError(
            "RESULT_TARGET_CHANGED",
            "Saved target changed.",
            409,
          );
        if (apply && intent.artifactId)
          await apply(
            db,
            { ...intent, artifactId: intent.artifactId },
            session,
          );
        else
          await registry
            .get(target.adapter, target.version)
            .apply(db, { ...intent, target }, session);
        await records.updateOne(
          { _id: intent._id, lease },
          { $set: { status: "applied" }, $unset: { lease: "", failure: "" } },
          { session },
        );
        phase = "commit";
      },
    });
  } catch (error) {
    await records.updateOne(
      { _id: intent._id, lease },
      {
        $set: {
          status: "failed",
          failure: { phase, code: failureCode(error), at: new Date() },
        },
        $unset: { lease: "" },
      },
    );
  }
  return true;
}
