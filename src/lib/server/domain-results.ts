import "server-only";
import type { Db, ClientSession } from "mongodb";
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
};
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
  try {
    const job = await aiJobs(db).findOne({
      _id: intent.jobId,
      uid: intent.uid,
      status: "succeeded",
    });
    if (!job) throw new Error();
    await readWallet(db, intent.uid, {
      actor: { uid: intent.uid, authTime: job.authTime },
      persist: async (session) => {
        const fenced = await records.findOne(
          { _id: intent._id, lease, status: "applying" },
          { session },
        );
        if (!fenced) throw new Error();
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
        if (!target) throw new Error("Missing owned target");
        const expected = jobTarget(job);
        if (!expected || fingerprint(expected) !== fingerprint(target))
          throw new Error("Target changed");
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
          { $set: { status: "applied" }, $unset: { lease: "" } },
          { session },
        );
      },
    });
  } catch {
    await records.updateOne(
      { _id: intent._id, lease },
      { $set: { status: "failed" }, $unset: { lease: "" } },
    );
  }
  return true;
}
