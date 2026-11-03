import "server-only";
import { requireModule } from "../modules";
import { PAGE_SIZE, pageCursor, readCursor } from "../pagination";
import type { Db, ClientSession, Document } from "mongodb";
import { parseInput } from "@/lib/input";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  artifactCreateSchema,
  artifactDraftSchema,
} from "@/lib/contracts/artifacts";
import type { parseUiForm } from "@/lib/contracts/runs";
import { aiJobs, fingerprint, type AiJob } from "../ai/jobs";
import { limits } from "@/lib/limits";
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
  parseInput(z.string().uuid(), id);
  const row = await db
    .collection<Artifact>("artifacts")
    .findOne({ id, uid, deleted: { $ne: true } }, { session });
  if (!row)
    throw new AppError("ARTIFACT_NOT_FOUND", "Artifact unavailable.", 404);
  return row;
}
export async function listArtifacts(cursor?: string, search = "") {
  const actor = await requireSession();
  return artifactPage(database(), actor.uid, cursor, search);
}
export async function artifactPage(
  db: Db,
  uid: string,
  cursor?: string,
  search = "",
) {
  const query = parseInput(z.string().trim().max(100), search);
  const scope = ["artifacts", uid, query];
  const after = readCursor(cursor, scope);
  if (
    after &&
    (typeof after.value !== "string" ||
      !Number.isFinite(Date.parse(after.value)))
  )
    throw new AppError("INVALID_INPUT", "Invalid page cursor.");
  const rows = await db
    .collection<Artifact>("artifacts")
    .find({
      uid,
      deleted: { $ne: true },
      ...(query
        ? {
            title: {
              $regex: query.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&"),
              $options: "i",
            },
          }
        : {}),
      ...(after
        ? {
            $or: [
              { createdAt: { $lt: new Date(after.value) } },
              { createdAt: new Date(after.value), id: { $lt: after.id } },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, id: -1 })
    .limit(PAGE_SIZE + 1)
    .toArray();
  const shown = rows.slice(0, PAGE_SIZE);
  const last = shown.at(-1);
  return {
    rows: shown.map(({ id, title, revision, approvedRevision, createdAt }) => ({
      id,
      title,
      revision,
      approvedRevision,
      createdAt: createdAt.toISOString(),
    })),
    next:
      rows.length > PAGE_SIZE && last
        ? pageCursor(scope, last.createdAt.toISOString(), last.id)
        : null,
  };
}
export async function createArtifact(input: unknown) {
  requireModule("artifacts");
  const actor = await requireSession();
  const data = parseInput(artifactCreateSchema, input);
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
export async function artifactDetail(id: string, cursor?: string) {
  const actor = await requireSession();
  const row = await ownedArtifact(database(), actor.uid, id);
  return {
    id: row.id,
    title: row.title,
    revision: row.revision,
    approvedRevision: row.approvedRevision,
    assets: row.assets,
    revisions: await artifactRevisionPage(database(), row, cursor),
  };
}
export async function artifactRevisionDetails(db: Db, artifact: Artifact) {
  return (await artifactRevisionPage(db, artifact)).rows;
}
export async function artifactRevisionPage(
  db: Db,
  artifact: Artifact,
  cursor?: string,
) {
  const scope = ["revisions", artifact.uid, artifact.id];
  const after = readCursor(cursor, scope);
  if (after && typeof after.value !== "number")
    throw new AppError("INVALID_INPUT", "Invalid page cursor.");

  const [revisions, images] = await Promise.all([
    db
      .collection<Revision>("artifactRevisions")
      .find({
        artifactId: artifact.id,
        uid: artifact.uid,
        ...(after ? { revision: { $lt: Number(after.value) } } : {}),
      })
      .sort({ revision: -1 })
      .limit(PAGE_SIZE + 1)
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
  const finalRevisions = await db
    .collection<Revision>("artifactRevisions")
    .aggregate<{ _id: string; revision: number }>([
      {
        $match: {
          artifactId: artifact.id,
          uid: artifact.uid,
          jobId: { $in: revisions.map((r) => r.jobId) },
        },
      },
      { $group: { _id: "$jobId", revision: { $max: "$revision" } } },
    ])
    .toArray();
  const finals = new Map(finalRevisions.map((r) => [r._id, r.revision]));
  const shown = revisions.slice(0, PAGE_SIZE);
  const rows = shown.map((r) => {
    const assets =
      finals.get(r.jobId) === r.revision
        ? artifact.assets.filter((id) => imageJobs.get(id) === r.jobId)
        : [];
    return {
      revision: r.revision,
      text: r.text,
      logicalId: r.logicalId,
      contentHash: r.contentHash,
      approvalSource: r.approvalSource ?? null,
      assets,
    };
  });
  return {
    rows,
    next:
      revisions.length > PAGE_SIZE
        ? pageCursor(scope, shown.at(-1)!.revision)
        : null,
  };
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
          ((decision.confirmedAction ?? decision.intent?.action) !==
            decision.approval.action &&
            !(
              job.run!.orchestrator.responseMode === "raw-v1" &&
              decision.answerSource?.type === "persona" &&
              !!job.run!.answerer &&
              decision.answerSource.personaId === job.run!.answerer.id &&
              decision.answerSource.personaRevision ===
                job.run!.answerer.revision &&
              !decision.approval.requireHuman &&
              (decision.confirmedAction ?? decision.intent?.action) ===
                "continue"
            )) ||
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
      { session, projection: { _id: 1 } },
    )
    .limit(limits.runImages)
    .toArray();
  const result = await db
    .collection<Document & { _id: string }>("runResults")
    .findOne(
      { _id: intent.jobId, uid: intent.uid },
      { session, projection: { "result.images.id": 1 } },
    );
  const available = new Set(images.map((image) => image._id));
  if (
    result?.result?.images?.some(
      (image: { id: string }) => !available.has(image.id),
    )
  )
    throw new AppError(
      "RESULT_ASSETS_UNAVAILABLE",
      "Saved result images are unavailable.",
      409,
    );
  const expected = result?.result?.images
    ? new Set<string>(
        result.result.images.map((image: { id: string }) => image.id),
      )
    : available;
  const selected = images.filter((image) => expected.has(image._id));
  for (const image of selected)
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
      { $addToSet: { assets: { $each: selected.map((i) => i._id) } } },
      { session },
    );
};

export {
  queueResultApplication,
  processOneResultApplication,
} from "../domain-results";
