import "server-only";
import { randomUUID } from "node:crypto";
import { MongoServerError, type Db, type ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { maximumCredits } from "@/lib/config/ai-pricing";
import {
  currentVersion,
  dependenciesCurrent,
  validAnswer,
  studioOutputSchema,
  reviewSchema,
  imageOutputSchema,
  type WorkspaceView,
  type WorkspaceCommand,
} from "@/lib/contracts/workspace";
import { accessPermitsSession, type AccountAccess } from "../store/access";
import { aiJobs, createAiJob, fingerprint } from "../ai/jobs";
import {
  aiConfig,
  bindingSnapshot,
  capability,
  capabilityPricing,
} from "../ai/capabilities";
import {
  assetRecord,
  mongoAssetStore,
  validatedImage,
  type PrivateAsset,
} from "./assets";

type Actor = { uid: string; authTime: number };
type Request = Parameters<typeof createAiJob>[3];
type Batch = WorkspaceView["batches"][number] & {
  requests: Request[];
  intents: boolean[];
  decisions: string;
};
export type Workspace = Omit<WorkspaceView, "batches"> & {
  _id: string;
  uid: string;
  batches: Batch[];
};
type Operation = { _id: string; hash: string };
const workspaces = (db: Db) => db.collection<Workspace>("workspaces");
export async function createWorkspaceIndexes(db: Db) {
  await workspaces(db).createIndex({ uid: 1, updatedAt: -1, _id: -1 });
  await db
    .collection("workspaceAssets")
    .createIndex({ uid: 1, workspaceId: 1 });
}
const fail = (message: string, code = "WORKSPACE_CONFLICT") =>
  new AppError(code, message, 409);

async function transaction<T>(
  db: Db,
  actor: Actor,
  run: (session: ClientSession) => Promise<T>,
) {
  const access = db.collection<AccountAccess>("accountAccess");
  try {
    await access.updateOne(
      { _id: actor.uid },
      {
        $setOnInsert: {
          role: "member",
          status: "active",
          notBefore: 0,
          revision: 0,
          updatedAt: new Date(0),
        },
      },
      { upsert: true },
    );
  } catch (e) {
    if (!(e instanceof MongoServerError) || e.code !== 11000) throw e;
  }
  const session = db.client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        const record = await access.findOneAndUpdate(
          { _id: actor.uid },
          { $inc: { revision: 1 } },
          { session, returnDocument: "after" },
        );
        if (!record || !accessPermitsSession(record, actor.authTime))
          throw new AppError(
            "FORBIDDEN",
            "This account is not accessible.",
            403,
          );
        return run(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
    );
  } finally {
    await session.endSession();
  }
}
export async function ownedWorkspace(
  db: Db,
  uid: string,
  id: string,
  session?: ClientSession,
) {
  const workspace = await workspaces(db).findOne({ _id: id, uid }, { session });
  if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found.", 404);
  return workspace;
}
export async function listWorkspaces(db: Db, uid: string) {
  return workspaces(db)
    .find(
      { uid },
      { projection: { id: 1, title: 1, updatedAt: 1, revision: 1 } },
    )
    .sort({ updatedAt: -1, _id: -1 })
    .limit(50)
    .toArray();
}
export async function createWorkspace(
  db: Db,
  actor: Actor,
  id: string,
  title: string,
) {
  return transaction(db, actor, async (session) => {
    const old = await workspaces(db).findOne({ _id: id }, { session });
    if (old) {
      if (old.uid !== actor.uid || old.title !== title)
        throw fail("This creation key has already been used.");
      return old;
    }
    if (
      (await workspaces(db).countDocuments({ uid: actor.uid }, { session })) >=
      50
    )
      throw fail("The template supports up to 50 workspaces per account.");
    const workspace: Workspace = {
      schemaVersion: 1,
      _id: id,
      id,
      uid: actor.uid,
      title,
      revision: 0,
      paused: false,
      updatedAt: new Date().toISOString(),
      cards: [],
      artifacts: [],
      reviews: [],
      approvals: [],
      batches: [],
      assets: [],
    };
    await workspaces(db).insertOne(workspace, { session });
    return workspace;
  });
}
export async function workspaceView(
  db: Db,
  workspace: Workspace,
): Promise<WorkspaceView> {
  const jobs = await aiJobs(db)
    .find(
      {
        uid: workspace.uid,
        _id: {
          $in: workspace.batches.flatMap((b) => b.items.map((i) => i.jobId)),
        },
      },
      { projection: { inputs: 0, "execution.outputs.png": 0 } },
    )
    .toArray();
  const byId = new Map(jobs.map((job) => [job._id, job]));
  return {
    schemaVersion: 1,
    id: workspace.id,
    title: workspace.title,
    revision: workspace.revision,
    paused: workspace.paused,
    updatedAt: workspace.updatedAt,
    cards: workspace.cards,
    artifacts: workspace.artifacts,
    reviews: workspace.reviews,
    approvals: workspace.approvals,
    assets: workspace.assets,
    batches: workspace.batches.map((batch) => ({
      id: batch.id,
      capability: batch.capability,
      prompt: batch.prompt,
      dependencies: batch.dependencies,
      targetId: batch.targetId,
      selected: batch.selected,
      createdAt: batch.createdAt,
      maximumCredits: batch.maximumCredits,
      items: batch.items.map((item) => {
        const job = byId.get(item.jobId);
        return {
          ...item,
          status: job?.status ?? "pending",
          error: job?.failure ?? item.error,
          // Inline images stay on the server until validated and imported as an asset.
          output:
            job?.status === "succeeded"
              ? batch.capability === "workspace-image"
                ? { title: job.execution?.outputs?.title ?? "Image ready" }
                : (job.execution?.outputs ?? null)
              : null,
        };
      }),
    })),
  };
}
function checkSources(
  workspace: Workspace,
  dependencies: WorkspaceView["batches"][number]["dependencies"],
) {
  if (
    new Set(dependencies.map((d) => d.artifactId)).size !==
      dependencies.length ||
    !dependenciesCurrent(workspace, dependencies)
  )
    throw fail(
      "A source version changed. Review the current artifacts before continuing.",
    );
}
function decisionsHash(workspace: Workspace) {
  return fingerprint(
    workspace.cards
      .filter((c) => c.status === "answered")
      .map((c) => ({ id: c.id, answer: c.answer })),
  );
}
function invalidateDecisions(workspace: Workspace) {
  const current = decisionsHash(workspace);
  for (const artifact of workspace.artifacts) {
    const snapshot = currentVersion(artifact).decisionFingerprint;
    if (snapshot && snapshot !== current) invalidate(workspace, artifact.id);
  }
}
function checkBatchSources(workspace: Workspace, batch: Batch) {
  checkSources(workspace, batch.dependencies);
  if (batch.decisions !== decisionsHash(workspace))
    throw fail(
      "Saved decisions changed. Generate new candidates using your current answers.",
    );
}
function getArtifact(workspace: Workspace, id: string) {
  const artifact = workspace.artifacts.find((a) => a.id === id);
  if (!artifact) throw fail("Artifact not found.");
  return artifact;
}
function invalidate(workspace: Workspace, changed: string) {
  const invalid = new Set([changed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const artifact of workspace.artifacts) {
      if (
        !invalid.has(artifact.id) &&
        currentVersion(artifact).dependencies.some((d) =>
          invalid.has(d.artifactId),
        )
      ) {
        invalid.add(artifact.id);
        grew = true;
      }
    }
  }
  for (const artifact of workspace.artifacts)
    if (invalid.has(artifact.id)) artifact.approval = null;
}
function saveVersion(
  workspace: Workspace,
  id: string | null,
  title: string,
  body: string,
  dependencies: WorkspaceView["batches"][number]["dependencies"],
  sourceJobId: string | null,
  assetId: string | null = null,
  decisionFingerprint: string | null = null,
) {
  checkSources(workspace, dependencies);
  let artifact = id ? getArtifact(workspace, id) : null;
  const artifactId = artifact?.id ?? randomUUID();
  // Prevent dependency cycles including through older source versions.
  const visit = (source: string, seen = new Set<string>()): boolean => {
    if (source === artifactId) return true;
    if (seen.has(source)) return false;
    seen.add(source);
    return currentVersion(getArtifact(workspace, source)).dependencies.some(
      (d) => visit(d.artifactId, seen),
    );
  };
  if (dependencies.some((d) => visit(d.artifactId)))
    throw fail("Artifact dependencies cannot contain a cycle.");
  if (!artifact) {
    artifact = { id: artifactId, versions: [], approval: null };
    workspace.artifacts.push(artifact);
  }
  if (artifact.versions.length >= 30)
    throw fail("This artifact has reached its 30-version limit.");
  artifact.versions.push({
    number: artifact.versions.length + 1,
    title,
    body,
    dependencies,
    assetId,
    sourceJobId,
    decisionFingerprint,
    createdAt: new Date().toISOString(),
  });
  invalidate(workspace, artifact.id);
}
function addAsset(workspace: Workspace, asset: PrivateAsset) {
  if (workspace.assets.length >= 50)
    throw fail("This workspace has reached its 50-asset limit.");
  workspace.assets.push({
    id: asset._id,
    name: asset.name,
    mime: asset.mime,
    bytes: asset.bytes,
  });
}
export async function commandWorkspace(
  db: Db,
  actor: Actor,
  id: string,
  command: WorkspaceCommand,
) {
  if (command.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  // Validate/decode outside the retryable transaction; never call a provider there.
  const existing = await ownedWorkspace(db, actor.uid, id);
  const operationId = fingerprint([actor.uid, id, command.key]);
  const hash = fingerprint(command);
  const prior = await db
    .collection<Operation>("workspaceOperations")
    .findOne({ _id: operationId });
  if (prior) {
    if (prior.hash !== hash)
      throw fail("This request key was used for different input.");
    const replayed = await transaction(db, actor, (session) =>
      ownedWorkspace(db, actor.uid, id, session),
    );
    if (command.action === "batch" || command.action === "admit") {
      await admitBatch(
        db,
        actor,
        id,
        command.action === "batch" ? command.key : command.batchId,
      );
      return ownedWorkspace(db, actor.uid, id);
    }
    return replayed;
  }
  let preparedAsset: PrivateAsset | null = null;
  if (command.action === "upload") {
    const normalized = await validatedImage(command.base64);
    preparedAsset = assetRecord(
      command.key,
      actor.uid,
      id,
      `${command.name.replace(/\.[^.]*$/, "")}.png`,
      normalized.bytes,
      normalized.mime,
    );
  }
  if (command.action === "select") {
    const batch = existing.batches.find((b) => b.id === command.batchId);
    if (batch?.capability === "workspace-image") {
      const job = await aiJobs(db).findOne({
        _id: batch.items[command.index]?.jobId,
        uid: actor.uid,
        status: "succeeded",
      });
      if (!job) throw fail("Wait for a settled successful result.");
      const output = imageOutputSchema.parse(job.execution?.outputs);
      const normalized = await validatedImage(output.png);
      preparedAsset = assetRecord(
        command.key,
        actor.uid,
        id,
        `${output.title}.png`,
        normalized.bytes,
        normalized.mime,
      );
    }
  }
  const result = await transaction(db, actor, async (session) => {
    const workspace = await ownedWorkspace(db, actor.uid, id, session);
    const prior = await db
      .collection<Operation>("workspaceOperations")
      .findOne({ _id: operationId }, { session });
    if (prior) {
      if (prior.hash !== hash)
        throw fail("This request key was used for different input.");
      return workspace;
    }
    if (command.revision !== workspace.revision)
      throw fail("This workspace changed. Refresh before continuing.");
    const now = new Date().toISOString();
    switch (command.action) {
      case "answer": {
        const card = workspace.cards.find((c) => c.id === command.cardId);
        if (
          !card ||
          card.status !== "active" ||
          !validAnswer(card.question, command.value)
        )
          throw fail("Choose an offered answer for an active question.");
        card.answer = command.value;
        card.status = "answered";
        invalidateDecisions(workspace);
        break;
      }
      case "reopen": {
        const card = workspace.cards.find((c) => c.id === command.cardId);
        if (!card || card.status !== "answered")
          throw fail("Only an answered question can be reopened.");
        card.status = "superseded";
        workspace.cards.push({
          ...card,
          id: command.key,
          answer: null,
          status: "active",
          createdAt: now,
        });
        invalidateDecisions(workspace);
        break;
      }
      case "save":
        saveVersion(
          workspace,
          command.artifactId,
          command.title,
          command.body,
          command.dependencies,
          null,
        );
        break;
      case "approve": {
        const artifact = getArtifact(workspace, command.artifactId);
        const version = currentVersion(artifact);
        if (version.number !== command.version)
          throw fail("Approve only the current version.");
        if (
          version.decisionFingerprint &&
          version.decisionFingerprint !== decisionsHash(workspace)
        )
          throw fail(
            "Saved decisions changed. Revise this artifact before approval.",
          );
        checkSources(workspace, version.dependencies);
        if (
          version.dependencies.some(
            (d) =>
              getArtifact(workspace, d.artifactId).approval?.version !==
              d.version,
          )
        )
          throw fail("Approve the current source artifacts first.");
        const blocking = workspace.reviews
          .filter(
            (r) => r.artifactId === artifact.id && r.version === version.number,
          )
          .some((r) => r.result.issues.some((i) => i.severity === "blocking"));
        if (blocking && command.reason.length < 10)
          throw fail(
            "Explain why you accept the blocking review findings (at least 10 characters).",
          );
        artifact.approval = {
          version: version.number,
          uid: actor.uid,
          at: now,
          reason: command.reason,
        };
        workspace.approvals.push({
          ...artifact.approval,
          artifactId: artifact.id,
        });
        break;
      }
      case "pause":
        workspace.paused = command.paused;
        break;
      case "batch": {
        if (workspace.paused)
          throw fail("Resume the workspace before creating a batch.");
        checkSources(workspace, command.dependencies);
        const target = command.targetId
          ? getArtifact(workspace, command.targetId)
          : null;
        if (command.capability === "workspace-review" && !target)
          throw fail("Choose an artifact to review.");
        const dependencies = [...command.dependencies];
        if (target) {
          for (const source of currentVersion(target).dependencies) {
            if (!dependencies.some((d) => d.artifactId === source.artifactId))
              dependencies.push({
                artifactId: source.artifactId,
                version: currentVersion(
                  getArtifact(workspace, source.artifactId),
                ).number,
              });
          }
        }
        if (target && !dependencies.some((d) => d.artifactId === target.id))
          dependencies.push({
            artifactId: target.id,
            version: currentVersion(target).number,
          });
        const selected = capability(command.capability);
        const pricing = capabilityPricing(selected);
        if (fingerprint(pricing) !== command.pricingKey)
          throw fail("Pricing changed. Reload and review the current maximum.");
        const binding = bindingSnapshot(selected.name, aiConfig());
        const context = JSON.stringify({
          decisions: workspace.cards
            .filter((c) => c.status === "answered")
            .map((c) => ({ question: c.question.title, answer: c.answer })),
          sources: dependencies.map((d) => ({
            id: d.artifactId,
            ...currentVersion(getArtifact(workspace, d.artifactId)),
          })),
        });
        if (context.length > 40000)
          throw fail(
            "The selected context is too large. Choose fewer or shorter sources.",
          );
        const inputs = selected.parseInput({ prompt: command.prompt, context });
        if (Buffer.byteLength(JSON.stringify(inputs)) > 64 * 1024)
          throw fail(
            "The selected context exceeds the AI input budget. Choose fewer or shorter sources.",
          );
        const requests: Request[] = Array.from(
          { length: command.count },
          () => ({
            capability: selected.name,
            capabilityVersion: selected.version,
            pricing,
            credits: maximumCredits(pricing),
            binding,
            inputs,
            source: {
              type: "workspace",
              id,
              version: String(workspace.revision),
            },
          }),
        );
        workspace.batches.push({
          id: command.key,
          capability: command.capability,
          prompt: command.prompt,
          dependencies,
          decisions: decisionsHash(workspace),
          targetId: command.targetId,
          selected: null,
          createdAt: now,
          maximumCredits: maximumCredits(pricing) * command.count,
          requests,
          intents: requests.map(() => false),
          items: requests.map((_, i) => ({
            jobId: fingerprint([actor.uid, `workspace:${command.key}:${i}`]),
            status: "pending",
            error: null,
            output: null,
          })),
        });
        break;
      }
      case "admit": {
        if (workspace.paused)
          throw fail("Resume the workspace before admitting pending jobs.");
        const batch = workspace.batches.find((b) => b.id === command.batchId);
        if (!batch) throw fail("Batch not found.");
        checkBatchSources(workspace, batch);
        break;
      }
      case "select": {
        const batch = workspace.batches.find((b) => b.id === command.batchId);
        if (!batch || batch.selected !== null || !batch.items[command.index])
          throw fail(
            "This batch has already been selected or has no such candidate.",
          );
        checkBatchSources(workspace, batch);
        const job = await aiJobs(db).findOne(
          {
            _id: batch.items[command.index].jobId,
            uid: actor.uid,
            status: "succeeded",
          },
          { session },
        );
        if (!job?.execution?.outputs || job.cleanedAt)
          throw fail(
            "Only a retained, settled successful result can be selected.",
          );
        if (batch.capability === "workspace-compose") {
          const output = studioOutputSchema.parse(job.execution.outputs);
          if (output.type === "question")
            workspace.cards.push({
              id: command.key,
              question: output.question,
              answer: null,
              status: "active",
              createdAt: now,
            });
          else
            saveVersion(
              workspace,
              batch.targetId,
              output.draft.title,
              output.draft.body,
              batch.dependencies.filter((d) => d.artifactId !== batch.targetId),
              job._id,
              null,
              batch.decisions,
            );
        } else if (batch.capability === "workspace-review") {
          const target = getArtifact(workspace, batch.targetId!);
          workspace.reviews.push({
            id: command.key,
            artifactId: target.id,
            version: currentVersion(target).number,
            result: reviewSchema.parse(job.execution.outputs),
            jobId: job._id,
            createdAt: now,
          });
          // A new review reopens human approval, including reviews arriving after approval.
          invalidate(workspace, target.id);
        } else {
          if (!preparedAsset) throw fail("Image validation is required.");
          addAsset(workspace, preparedAsset);
          await mongoAssetStore(db).put(preparedAsset, session);
          saveVersion(
            workspace,
            batch.targetId,
            imageOutputSchema.parse(job.execution.outputs).title,
            "",
            batch.dependencies.filter((d) => d.artifactId !== batch.targetId),
            job._id,
            preparedAsset._id,
            batch.decisions,
          );
        }
        batch.selected = command.index;
        break;
      }
      case "upload": {
        if (!preparedAsset) throw fail("Image validation is required.");
        addAsset(workspace, preparedAsset);
        await mongoAssetStore(db).put(preparedAsset, session);
        saveVersion(
          workspace,
          null,
          command.name,
          "",
          [],
          null,
          preparedAsset._id,
        );
        break;
      }
      case "export": {
        const artifact = getArtifact(workspace, command.artifactId);
        const version = artifact.versions.find(
          (v) => v.number === command.version,
        );
        if (!version) throw fail("Version not found.");
        const bytes = Buffer.from(
          command.format === "json"
            ? JSON.stringify(
                {
                  schemaVersion: 1,
                  artifactId: artifact.id,
                  version,
                  approval:
                    artifact.approval?.version === version.number
                      ? artifact.approval
                      : null,
                },
                null,
                2,
              )
            : `${version.title}\n\n${version.body}\n${version.assetId ? `Private image asset: ${version.assetId}\n` : ""}`,
        );
        const asset = assetRecord(
          command.key,
          actor.uid,
          id,
          `artifact-v${version.number}.${command.format === "json" ? "json" : "txt"}`,
          bytes,
          command.format === "json"
            ? "application/json"
            : "text/plain; charset=utf-8",
        );
        addAsset(workspace, asset);
        await mongoAssetStore(db).put(asset, session);
        break;
      }
    }
    if (
      workspace.cards.length > 100 ||
      workspace.artifacts.length > 30 ||
      workspace.batches.length > 50 ||
      workspace.reviews.length > 100 ||
      workspace.approvals.length > 200 ||
      Buffer.byteLength(JSON.stringify(workspace)) > 2 * 1024 * 1024
    )
      throw fail(
        "This workspace reached its size limit. Create another workspace.",
      );
    workspace.revision++;
    workspace.updatedAt = now;
    await workspaces(db).replaceOne({ _id: id, uid: actor.uid }, workspace, {
      session,
    });
    await db
      .collection<Operation>("workspaceOperations")
      .insertOne({ _id: operationId, hash }, { session });
    return workspace;
  });
  if (command.action === "batch" || command.action === "admit") {
    await admitBatch(
      db,
      actor,
      id,
      command.action === "batch" ? command.key : command.batchId,
    );
    return ownedWorkspace(db, actor.uid, id);
  }
  return result;
}

async function admitBatch(db: Db, actor: Actor, id: string, batchId: string) {
  const initial = await ownedWorkspace(db, actor.uid, id);
  const batch = initial.batches.find((b) => b.id === batchId);
  if (!batch) throw fail("Batch not found.");
  for (let index = 0; index < batch.items.length; index++) {
    // Persist admission intent before reserving credits. A crash can be resumed
    // using the exact same job key, binding, price and inputs. Pausing prevents new
    // intents; an intent accepted before pause may finish admission afterward.
    const admitted = await transaction(db, actor, async (session) => {
      const workspace = await ownedWorkspace(db, actor.uid, id, session);
      const current = workspace.batches.find((b) => b.id === batchId)!;
      if (
        workspace.paused ||
        current.selected !== null ||
        !dependenciesCurrent(workspace, current.dependencies) ||
        current.decisions !== decisionsHash(workspace)
      )
        return false;
      current.intents[index] = true;
      await workspaces(db).replaceOne({ _id: id, uid: actor.uid }, workspace, {
        session,
      });
      return true;
    });
    if (!admitted) break;
    let error: string | null = null;
    try {
      await createAiJob(
        db,
        actor,
        `workspace:${batchId}:${index}`,
        batch.requests[index],
      );
    } catch (e) {
      error =
        e instanceof AppError
          ? e.message
          : "Admission interrupted. Retry pending jobs with the saved request.";
    }
    await transaction(db, actor, async (session) => {
      await workspaces(db).updateOne(
        { _id: id, uid: actor.uid },
        { $set: { [`batches.$[batch].items.${index}.error`]: error } },
        { arrayFilters: [{ "batch.id": batchId }], session },
      );
    });
  }
}
