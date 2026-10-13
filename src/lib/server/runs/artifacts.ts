import "server-only";
import type { Db, ClientSession, Document } from "mongodb";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  artifactCreateSchema,
  artifactDraftSchema,
} from "@/lib/contracts/artifacts";
import type { parseUiForm } from "@/lib/contracts/runs";
import { aiJobs, fingerprint, type AiJob } from "../ai/jobs";
import { database } from "../mongo";
async function requireSession() {
  return (await import("../session")).requireSession();
}
import { readWallet } from "../store/credits";
import { promoteAsset, releaseAssetReference } from "./assets";
import { authorizedRun } from "./capabilities";
import type { Decision } from "./service";
import type { ProductAsset } from "./assets";

export type Artifact = {
  id: string;
  uid: string;
  title: string;
  revision: number;
  approvedRevision: number | null;
  assets: string[];
  deleted?: boolean;
  createdAt: Date;
};
type Revision = {
  _id: string;
  artifactId: string;
  uid: string;
  revision: number;
  text: string;
  contentHash: string;
  jobId: string;
  logicalId: string;
  createdAt: Date;
  approvalSource?: Decision["answerSource"];
};
export async function ownedArtifact(
  db: Db,
  uid: string,
  id: string,
  session?: ClientSession,
) {
  const row = await db
    .collection<Artifact>("artifacts")
    .findOne({ id, uid, deleted: { $ne: true } }, { session });
  if (!row)
    throw new AppError("ARTIFACT_NOT_FOUND", "Artifact unavailable.", 404);
  return row;
}
export async function listArtifacts() {
  const actor = await requireSession();
  return database()
    .collection<Artifact>("artifacts")
    .find({ uid: actor.uid, deleted: { $ne: true } })
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();
}
export async function createArtifact(input: unknown) {
  const actor = await requireSession();
  const data = artifactCreateSchema.parse(input);
  await readWallet(database(), actor.uid, {
    actor: { uid: actor.uid, authTime: actor.auth_time },
    persist: async (session) => {
      const old = await database()
        .collection<Artifact>("artifacts")
        .findOne({ id: data.id }, { session });
      if (
        old &&
        (old.uid !== actor.uid || old.title !== data.title || old.deleted)
      )
        throw new AppError(
          "ARTIFACT_CONFLICT",
          "Artifact request changed.",
          409,
        );
      if (!old)
        await database()
          .collection<Artifact>("artifacts")
          .insertOne(
            {
              ...data,
              uid: actor.uid,
              revision: 0,
              approvedRevision: null,
              assets: [],
              createdAt: new Date(),
            },
            { session },
          );
    },
  });
  return { id: data.id };
}
export async function artifactDetail(id: string) {
  const actor = await requireSession();
  const row = await ownedArtifact(database(), actor.uid, id);
  return {
    id: row.id,
    title: row.title,
    revision: row.revision,
    approvedRevision: row.approvedRevision,
    assets: row.assets,
    revisions: await artifactRevisionDetails(database(), row),
  };
}
export async function artifactRevisionDetails(db: Db, artifact: Artifact) {
  const [revisions, images] = await Promise.all([
    db
      .collection<Revision>("artifactRevisions")
      .find({ artifactId: artifact.id, uid: artifact.uid })
      .sort({ revision: -1 })
      .limit(100)
      .toArray(),
    db
      .collection<ProductAsset>("productAssets")
      .find({
        _id: { $in: artifact.assets },
        uid: artifact.uid,
        state: "ready",
        references: `artifact:${artifact.id}`,
        jobId: { $exists: true },
      })
      .project<Pick<ProductAsset, "_id" | "jobId">>({ _id: 1, jobId: 1 })
      .toArray(),
  ]);
  const imageJobs = new Map(images.map((image) => [image._id, image.jobId]));
  const assignedJobs = new Set<string>();
  return revisions.map((r) => {
    // A completed attempt's images belong to its final saved revision. The
    // retained product metadata keeps this association after Run cleanup.
    const assets = assignedJobs.has(r.jobId)
      ? []
      : artifact.assets.filter((id) => imageJobs.get(id) === r.jobId);
    assignedJobs.add(r.jobId);
    return {
      revision: r.revision,
      text: r.text,
      logicalId: r.logicalId,
      contentHash: r.contentHash,
      approvalSource: r.approvalSource ?? null,
      assets,
    };
  });
}
export async function deleteArtifact(id: string) {
  const actor = await requireSession();
  await readWallet(database(), actor.uid, {
    actor: { uid: actor.uid, authTime: actor.auth_time },
    persist: async (session) => {
      await ownedArtifact(database(), actor.uid, id, session);
      await database()
        .collection<Artifact>("artifacts")
        .updateOne(
          { id, uid: actor.uid },
          { $set: { deleted: true } },
          { session },
        );
      await releaseAssetReference(
        database(),
        actor.uid,
        `artifact:${id}`,
        session,
      );
    },
  });
  return { id };
}
export async function validateApprovalIntent(
  db: Db,
  job: AiJob,
  approval: NonNullable<ReturnType<typeof parseUiForm>["approval"]>,
) {
  if (
    job.run?.artifactId !== approval.artifactId ||
    !(await db.collection<Revision>("artifactRevisions").findOne({
      artifactId: approval.artifactId,
      uid: job.uid,
      revision: approval.revision,
      contentHash: approval.contentHash,
      jobId: job._id,
    }))
  )
    throw new AppError(
      "APPROVAL_INVALID",
      "Approval target is unavailable.",
      409,
    );
}
export async function artifactOperation(
  db: Db,
  token: string,
  clientId: string,
  operation: "save_artifact_draft_v1" | "approve_artifact_v1",
  input: unknown,
  signal: AbortSignal,
  authorize?: typeof import("../worker-authorization").authorizeWorkerAccount,
) {
  const data =
    operation === "save_artifact_draft_v1"
      ? artifactDraftSchema.parse(input)
      : z
          .strictObject({
            operationKey: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
            revision: z.number().int().positive(),
            contentHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .parse(input);
  const job = await authorizedRun(
    db,
    token,
    clientId,
    operation,
    undefined,
    authorize,
  );
  if (!job.run?.artifactId)
    throw new AppError("ARTIFACT_REQUIRED", "This Run has no artifact.", 409);
  let result:
    { artifactId: string; revision: number; contentHash: string } | undefined;
  await readWallet(db, job.uid, {
    actor: { uid: job.uid, authTime: job.authTime },
    persist: async (session) => {
      signal.throwIfAborted();
      await authorizedRun(db, token, clientId, operation, session, authorize);
      await aiJobs(db).updateOne(
        { _id: job._id },
        { $inc: { operationFence: 1 } },
        { session },
      );
      const records = db.collection<Document & { _id: string }>(
        "productOperations",
      );
      const id = fingerprint([job._id, operation, data.operationKey]);
      const payloadHash = fingerprint(data);
      const old = await records.findOne({ _id: id }, { session });
      if (old) {
        if (old.payloadHash !== payloadHash)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "Operation key was reused.",
            409,
          );
        result = old.result;
        return;
      }
      const artifact = await ownedArtifact(
        db,
        job.uid,
        job.run!.artifactId!,
        session,
      );
      if ("text" in data) {
        if (artifact.revision !== data.expectedRevision)
          throw new AppError(
            "ARTIFACT_CONFLICT",
            "Artifact revision changed.",
            409,
          );
        const revision = artifact.revision + 1;
        const contentHash = fingerprint(data.text);
        await db.collection<Revision>("artifactRevisions").insertOne(
          {
            _id: fingerprint([artifact.id, revision]),
            uid: job.uid,
            artifactId: artifact.id,
            revision,
            text: data.text,
            contentHash,
            jobId: job._id,
            logicalId: job.run!.logicalId,
            createdAt: new Date(),
          },
          { session },
        );
        await db
          .collection<Artifact>("artifacts")
          .updateOne({ id: artifact.id }, { $set: { revision } }, { session });
        result = { artifactId: artifact.id, revision, contentHash };
      } else {
        const decision = await db.collection<Decision>("runDecisions").findOne(
          {
            jobId: job._id,
            status: "submitted",
            "approval.artifactId": artifact.id,
            "approval.revision": data.revision,
            "approval.contentHash": data.contentHash,
          },
          { session },
        );
        if (
          !decision?.approval ||
          (decision.approval.requireHuman &&
            decision.answerSource?.type !== "user") ||
          (decision.confirmedAction ?? decision.intent?.action) !==
            decision.approval.action ||
          artifact.revision !== data.revision
        )
          throw new AppError(
            "APPROVAL_REQUIRED",
            "A matching confirmed approval is required.",
            409,
          );
        await db
          .collection<Artifact>("artifacts")
          .updateOne(
            { id: artifact.id },
            { $set: { approvedRevision: data.revision } },
            { session },
          );
        await db.collection<Revision>("artifactRevisions").updateOne(
          {
            artifactId: artifact.id,
            revision: data.revision,
            contentHash: data.contentHash,
          },
          {
            $set: {
              approvalSource: decision.answerSource ?? { type: "user" },
            },
          },
          { session },
        );
        result = {
          artifactId: artifact.id,
          revision: data.revision,
          contentHash: data.contentHash,
        };
      }
      await records.insertOne(
        {
          _id: id,
          jobId: job._id,
          uid: job.uid,
          operation,
          payloadHash,
          result,
          createdAt: new Date(),
        },
        { session },
      );
      signal.throwIfAborted();
    },
  });
  return result!;
}

type Application = {
  _id: string;
  uid: string;
  jobId: string;
  artifactId: string;
  status: "pending" | "applying" | "applied" | "failed";
  nextAttemptAt: Date;
  lease?: string;
};
export async function queueResultApplication(
  db: Db,
  job: AiJob,
  session: ClientSession,
) {
  if (!job.run?.artifactId) return;
  await db.collection<Application>("resultApplications").updateOne(
    { _id: fingerprint([job._id, "artifact", "1"]) },
    {
      $setOnInsert: {
        uid: job.uid,
        jobId: job._id,
        artifactId: job.run.artifactId,
        status: "pending",
        nextAttemptAt: new Date(),
      },
    },
    { upsert: true, session },
  );
}
// This typed handler is the reference extension point; downstream handlers validate their own domain association.
export type ProductResultHandler = (
  db: Db,
  intent: { uid: string; jobId: string; artifactId: string },
  session: ClientSession,
) => Promise<void>;
export const applyArtifactResult: ProductResultHandler = async (
  db,
  intent,
  session,
) => {
  const artifact = await ownedArtifact(
    db,
    intent.uid,
    intent.artifactId,
    session,
  );
  const images = await db
    .collection<Document & { _id: string }>("runAssets")
    .find(
      { uid: intent.uid, jobId: intent.jobId, status: "ready" },
      { session },
    )
    .limit(10)
    .toArray();
  for (const image of images)
    await promoteAsset(
      db,
      intent.uid,
      intent.jobId,
      image._id,
      `artifact:${artifact.id}`,
      session,
    );
  await db
    .collection<Artifact>("artifacts")
    .updateOne(
      { id: artifact.id },
      { $addToSet: { assets: { $each: images.map((i) => i._id) } } },
      { session },
    );
};
export async function processOneResultApplication(
  db: Db,
  apply: ProductResultHandler = applyArtifactResult,
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
        await apply(db, intent, session);
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
