import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { aiJobs, canStartNewAttempt } from "../ai/jobs";
import { assetStages, type StoredAsset } from "./asset-storage";
import type { Workspace } from "./store";

export async function deletableWorkspace(
  db: Db,
  workspace: Workspace,
  session: ClientSession,
  now: Date,
) {
  if (!workspace.archivedAt || !workspace.paused) return false;
  if (
    await db.collection("workspaceExports").countDocuments(
      {
        uid: workspace.uid,
        workspaceId: workspace.id,
        $or: [
          { status: { $in: ["queued", "rendering"] } },
          { leaseUntil: { $gt: now } },
        ],
      },
      { session },
    )
  )
    return false;
  if (
    await db.collection("workspaceWorkflows").countDocuments(
      {
        uid: workspace.uid,
        workspaceId: workspace.id,
        status: { $in: ["active", "paused"] },
      },
      { session },
    )
  )
    return false;
  if (
    await assetStages(db).countDocuments(
      { uid: workspace.uid, workspaceId: workspace.id, state: "uploading" },
      { session },
    )
  )
    return false;
  const ids = workspace.batches.flatMap((batch) =>
    batch.items.map((item) => item.jobId),
  );
  const jobs = await aiJobs(db)
    .find(
      {
        uid: workspace.uid,
        $or: [
          { _id: { $in: ids } },
          { "source.type": "workspace", "source.id": workspace.id },
        ],
      },
      { session },
    )
    .toArray();
  const found = new Set(jobs.map((job) => job._id));
  // An accepted admission intent may still create a job after archiving. Keep
  // its workspace until that job has durable terminal evidence.
  if (
    workspace.batches.some((batch) =>
      batch.items.some((item, i) => batch.intents[i] && !found.has(item.jobId)),
    )
  )
    return false;
  return jobs.every(
    (job) =>
      job.leaseUntil <= now &&
      (job.status === "succeeded" || canStartNewAttempt(job)),
  );
}

// Called only inside an authorized administrator cleanup transaction. The owner
// access write serializes against uploads/admissions and archive/restore commands.
export async function deleteArchivedWorkspace(
  db: Db,
  id: string,
  revision: number,
  cutoff: Date,
  session: ClientSession,
  now: Date,
) {
  const workspaces = db.collection<Workspace>("workspaces");
  const workspace = await workspaces.findOne(
    {
      _id: id,
      revision,
      archivedAt: { $lt: cutoff.toISOString(), $type: "string" },
    },
    { session },
  );
  if (!workspace) return null;
  await db
    .collection<{ _id: string }>("accountAccess")
    .updateOne({ _id: workspace.uid }, { $inc: { revision: 1 } }, { session });
  if (!(await deletableWorkspace(db, workspace, session, now))) return null;
  const owner = { uid: workspace.uid, workspaceId: id };
  const assets = await db
    .collection<StoredAsset>("workspaceAssets")
    .find(owner, { session })
    .toArray();
  const stages = await assetStages(db)
    .find({ ...owner, state: { $ne: "deleted" } }, { session })
    .toArray();
  const approved = stages.map((stage) => stage._id);
  for (const asset of assets) {
    if (!asset.object || stages.some((stage) => stage.assetId === asset._id))
      continue;
    const stageId = randomUUID();
    await assetStages(db).insertOne(
      {
        _id: stageId,
        ...owner,
        assetId: asset._id,
        state: "deleting",
        object: asset.object,
        bytes: asset.bytes,
        digest: asset.digest,
        createdAt: now,
        nextDeleteAt: now,
      },
      { session },
    );
    approved.push(stageId);
  }
  await assetStages(db).updateMany(
    { _id: { $in: approved }, state: { $in: ["ready", "attached"] } },
    { $set: { state: "deleting", nextDeleteAt: now } },
    { session },
  );
  const ids = workspace.batches.flatMap((batch) =>
    batch.items.map((item) => item.jobId),
  );
  await aiJobs(db).updateMany(
    {
      uid: workspace.uid,
      $or: [
        { _id: { $in: ids } },
        { "source.type": "workspace", "source.id": id },
      ],
    },
    {
      $set: { inputs: {}, source: null, cleanedAt: now },
      $unset: { "execution.outputs": "" },
    },
    { session },
  );
  // Keep job/ledger/audit and command fingerprints. Remove content-bearing run
  // definitions, messages, versions, decisions, prompts and inline asset bytes.
  await db.collection("workspaceWorkflows").deleteMany(owner, { session });
  await db.collection("workspaceExports").deleteMany(owner, { session });
  await db.collection("workspaceEvents").deleteMany(owner, { session });
  await db.collection("workspaceAssets").deleteMany(owner, { session });
  await db
    .collection<{
      _id: string;
      uid: string;
      deletedAt: Date;
      revision: number;
    }>("workspaceTombstones")
    .insertOne(
      { _id: id, uid: workspace.uid, deletedAt: now, revision },
      { session },
    );
  await workspaces.deleteOne(
    { _id: id, uid: workspace.uid, revision },
    { session },
  );
  return approved;
}
