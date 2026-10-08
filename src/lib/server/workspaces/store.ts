import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { maximumCredits } from "@/lib/config/ai-pricing";
import {
  artifactRegistry,
  parseArtifact,
  legacyArtifactContent,
} from "@/lib/creation/artifacts";
import {
  cardRegistry,
  parseCard,
  reviewCardSchema,
} from "@/lib/creation/cards";
import type { RegisteredValue } from "@/lib/creation/registry";
import { createProfileIndexes, resolveProfile } from "./profiles";
import {
  ensureQualityIssues,
  blockingIssues,
  changeQualityIssue,
} from "./quality";
import {
  appendCommandEvent,
  recentConversationContext,
  workspaceEvents,
  workspaceHistory,
} from "./history";
import {
  currentVersion,
  currentDecisionCard,
  dependenciesCurrent,
  validAnswer,
  studioOutputSchema,
  reviewSchema,
  imageOutputSchema,
  type WorkspaceView,
  type WorkspaceCommand,
} from "@/lib/contracts/workspace";
import { workspaceTransaction as transaction } from "./transaction";
export { workspaceTransaction } from "./transaction";
import {
  aiJobs,
  createAiJob,
  fingerprint,
  canStartNewAttempt,
} from "../ai/jobs";
import {
  aiConfig,
  bindingSnapshot,
  capability,
  capabilityPricing,
} from "../ai/capabilities";
import { assetRecord, validatedImage, type PrivateAsset } from "./assets";
import {
  privateAssetStore,
  createAssetStorageIndexes,
  type StagedAsset,
} from "./asset-storage";
import { imageByteLimit, parseAssetConfig } from "@/lib/config/assets";

type Actor = { uid: string; authTime: number };
type Request = Parameters<typeof createAiJob>[3];
type Batch = WorkspaceView["batches"][number] & {
  requests: Request[];
  intents: boolean[];
  decisions: string;
};
export type Workspace = Omit<WorkspaceView, "batches" | "timeline"> & {
  _id: string;
  uid: string;
  batches: Batch[];
};
type Operation = { _id: string; hash: string };
const workspaces = (db: Db) => db.collection<Workspace>("workspaces");
export async function createWorkspaceIndexes(db: Db) {
  await createAssetStorageIndexes(db);
  await createProfileIndexes(db);
  await workspaceEvents(db).createIndex({
    uid: 1,
    workspaceId: 1,
    createdAt: -1,
    _id: -1,
  });
  await workspaces(db).createIndex({ uid: 1, updatedAt: -1, _id: -1 });
  await workspaces(db).createIndex({ archivedAt: 1, _id: 1 });
  await db
    .collection("workspaceAssets")
    .createIndex({ uid: 1, workspaceId: 1 });
}
const fail = (message: string, code = "WORKSPACE_CONFLICT") =>
  new AppError(code, message, 409);

export async function ownedWorkspace(
  db: Db,
  uid: string,
  id: string,
  session?: ClientSession,
) {
  const workspace = await workspaces(db).findOne({ _id: id, uid }, { session });
  if (!workspace) throw new AppError("NOT_FOUND", "Workspace not found.", 404);
  // Additive compatibility: old snapshots remain readable without a destructive migration.
  workspace.uiCards ??= [];
  workspace.archivedAt ??= null;
  ensureQualityIssues(workspace);
  return workspace;
}
export async function listWorkspaces(db: Db, uid: string) {
  return workspaces(db)
    .find(
      { uid },
      {
        projection: {
          id: 1,
          title: 1,
          updatedAt: 1,
          revision: 1,
          archivedAt: 1,
        },
      },
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
    if (
      await db
        .collection<{ _id: string }>("workspaceTombstones")
        .findOne({ _id: id }, { session })
    )
      throw fail("This workspace was deleted. Use a new creation key.");
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
      archivedAt: null,
      updatedAt: new Date().toISOString(),
      cards: [],
      uiCards: [],
      artifacts: [],
      reviews: [],
      qualityIssues: [],
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
    timeline: await workspaceHistory(db, workspace.uid, workspace.id),
    id: workspace.id,
    title: workspace.title,
    revision: workspace.revision,
    paused: workspace.paused,
    archivedAt: workspace.archivedAt ?? null,
    updatedAt: workspace.updatedAt,
    cards: workspace.cards,
    uiCards: workspace.uiCards ?? [],
    artifacts: workspace.artifacts.map((artifact) => ({
      ...artifact,
      versions: artifact.versions.map((version) => ({
        ...version,
        content: legacyArtifactContent(version),
      })),
    })),
    reviews: workspace.reviews,
    qualityIssues: workspace.qualityIssues ?? [],
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
      referenceAssetIds: batch.referenceAssetIds ?? [],
      editAssetId: batch.editAssetId ?? null,
      ...(batch.retryOf ? { retryOf: batch.retryOf } : {}),
      items: batch.items.map((item) => {
        const job = byId.get(item.jobId);
        return {
          ...item,
          status: job?.status ?? "pending",
          retrySafe: job ? canStartNewAttempt(job) : false,
          error: job?.failure ?? item.error,
          // Inline images stay on the server until validated and imported as an asset.
          output:
            job?.status === "succeeded" && !job.cleanedAt
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
  const legacy = workspace.cards
    .filter((c) => c.status === "answered")
    .map((c) => ({ id: c.id, answer: c.answer }));
  const generated = (workspace.uiCards ?? [])
    .filter(
      (card) =>
        card.status === "answered" &&
        ["submit", "choose"].includes(card.responseAction ?? ""),
    )
    .map((card) => ({ id: card.id, answer: card.response }));
  // Preserve old fingerprints exactly while no new decisions have been saved.
  return fingerprint([...legacy, ...generated]);
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
  registeredContent?: RegisteredValue,
) {
  checkSources(workspace, dependencies);
  const content = parseArtifact(
    registeredContent ?? legacyArtifactContent({ title, body, assetId }),
  );
  const projection = artifactRegistry
    .get(content.type, content.version)
    .project(content.data);
  if (
    projection.assetIds.some(
      (id) => !workspace.assets.some((asset) => asset.id === id),
    )
  )
    throw fail("Artifact assets must belong to this workspace.");
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
    title: projection.title,
    body: projection.text,
    content,
    dependencies,
    assetId: projection.assetIds[0] ?? null,
    sourceJobId,
    decisionFingerprint,
    createdAt: new Date().toISOString(),
  });
  invalidate(workspace, artifact.id);
  workspace.uiCards ??= [];
  for (const card of workspace.uiCards) {
    if (
      card.content.type === "review" &&
      card.status === "active" &&
      reviewCardSchema.parse(card.content.data).artifactId === artifact.id
    )
      card.status = "superseded";
  }
  workspace.uiCards.push({
    id: randomUUID(),
    content: {
      type: "review",
      version: 1,
      data: {
        title: `Review ${projection.title}`.slice(0, 500),
        artifactId: artifact.id,
        version: artifact.versions.length,
        summary: projection.text.slice(0, 4000),
      },
    },
    status: "active",
    response: null,
    responseAction: null,
    createdAt: new Date().toISOString(),
    answeredAt: null,
    sourceJobId,
  });
}
function approveVersion(
  workspace: Workspace,
  actor: Actor,
  artifactId: string,
  number: number,
  reason: string,
  now: string,
) {
  const artifact = getArtifact(workspace, artifactId);
  const version = currentVersion(artifact);
  if (version.number !== number)
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
        getArtifact(workspace, d.artifactId).approval?.version !== d.version,
    )
  )
    throw fail("Approve the current source artifacts first.");
  const blocking = blockingIssues(workspace, artifact.id, version.number);
  if (blocking.length && reason.length < 10)
    throw fail(
      "Explain why you accept the blocking review findings (at least 10 characters).",
    );
  for (const issue of blocking)
    changeQualityIssue(workspace, actor.uid, issue.id, "accept", reason, now);
  artifact.approval = {
    version: version.number,
    uid: actor.uid,
    at: now,
    reason,
  };
  workspace.approvals.push({ ...artifact.approval, artifactId: artifact.id });
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
  options: {
    durableIntent?: {
      workflowId: string;
      lease: string;
      prerequisites?: {
        cardIds: string[];
        approvals: { artifactId: string; version: number }[];
      };
    };
  } = {},
) {
  async function guardWorkflow(session: ClientSession) {
    if (!options.durableIntent) return;
    if (!["batch", "admit", "select"].includes(command.action))
      throw fail("This command is not a workflow scheduling operation.");
    const guard = await db
      .collection<{
        _id: string;
        uid: string;
        workspaceId: string;
        status: string;
        lease: string | null;
        actionTick?: number;
      }>("workspaceWorkflows")
      .findOneAndUpdate(
        {
          _id: options.durableIntent.workflowId,
          uid: actor.uid,
          workspaceId: id,
          status: "active",
          lease: options.durableIntent.lease,
        },
        { $inc: { actionTick: 1 } },
        { session, returnDocument: "after" },
      );
    if (!guard)
      throw fail("The workflow paused, ended or changed while scheduling.");
  }
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
    const replayed = await transaction(db, actor, async (session) => {
      await guardWorkflow(session);
      return ownedWorkspace(db, actor.uid, id, session);
    });
    if (
      command.action === "batch" ||
      command.action === "admit" ||
      command.action === "retry-candidate"
    ) {
      await admitBatch(
        db,
        actor,
        id,
        command.action === "admit" ? command.batchId : command.key,
      );
      return ownedWorkspace(db, actor.uid, id);
    }
    return replayed;
  }
  let preparedAsset: StagedAsset | null = null;
  if (existing.archivedAt && command.action !== "archive")
    throw fail("Restore this archived workspace before changing it.");
  if (command.action === "upload") {
    const normalized = await validatedImage(
      command.base64,
      imageByteLimit(parseAssetConfig(process.env)),
    );
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
  if (preparedAsset)
    preparedAsset = await privateAssetStore(db).stage(preparedAsset, actor);
  const result = await transaction(db, actor, async (session) => {
    await guardWorkflow(session);
    const workspace = await ownedWorkspace(db, actor.uid, id, session);
    const prior = await db
      .collection<Operation>("workspaceOperations")
      .findOne({ _id: operationId }, { session });
    if (prior) {
      if (prior.hash !== hash)
        throw fail("This request key was used for different input.");
      return workspace;
    }
    // Durable workflow commands pin source versions and reuse an exact saved key.
    // They need not conflict with unrelated messages or other workflow branches.
    // User commands always retain the optimistic UI revision check.
    if (!options.durableIntent && command.revision !== workspace.revision)
      throw fail("This workspace changed. Refresh before continuing.");
    if (workspace.archivedAt && command.action !== "archive")
      throw fail("Restore this archived workspace before changing it.");
    const prerequisites = options.durableIntent?.prerequisites;
    if (command.action === "batch" && prerequisites) {
      if (
        prerequisites.cardIds.some(
          (cardId) =>
            currentDecisionCard(workspace, cardId)?.status !== "answered",
        )
      )
        throw fail(
          "A prerequisite decision was reopened. Answer it before resuming this run.",
        );
      if (
        !dependenciesCurrent(workspace, prerequisites.approvals) ||
        prerequisites.approvals.some(
          (source) =>
            workspace.artifacts.find(
              (artifact) => artifact.id === source.artifactId,
            )?.approval?.version !== source.version,
        )
      )
        throw fail(
          "A checkpoint approval changed. Restore its approved source versions before resuming, or start a new run.",
        );
    }
    const now = new Date().toISOString();
    switch (command.action) {
      case "archive": {
        if (
          command.archived &&
          (await db.collection("workspaceWorkflows").countDocuments(
            {
              uid: actor.uid,
              workspaceId: id,
              status: { $in: ["active", "paused"] },
            },
            { session },
          ))
        )
          throw fail("Finish or cancel workflow runs before archiving.");
        if (
          command.archived &&
          (await db.collection("workspaceExports").countDocuments(
            {
              uid: actor.uid,
              workspaceId: id,
              $or: [
                { status: { $in: ["queued", "rendering"] } },
                { leaseUntil: { $gt: new Date() } },
              ],
            },
            { session },
          ))
        )
          throw fail(
            "Finish or cancel exports and wait for their workers before archiving.",
          );
        workspace.archivedAt = command.archived ? now : null;
        // Restore keeps admission paused until the owner explicitly resumes it.
        workspace.paused = true;
        break;
      }
      case "quality-issue": {
        const artifactId = changeQualityIssue(
          workspace,
          actor.uid,
          command.issueId,
          command.resolution,
          command.reason,
          now,
        );
        invalidate(workspace, artifactId);
        break;
      }
      case "message":
        break; // The durable transcript is written with the mutation below.
      case "save-content": {
        const content = parseArtifact(command.content);
        const projection = artifactRegistry
          .get(content.type, content.version)
          .project(content.data);
        saveVersion(
          workspace,
          command.artifactId,
          projection.title,
          projection.text,
          command.dependencies,
          null,
          projection.assetIds[0] ?? null,
          null,
          content,
        );
        break;
      }
      case "respond-card": {
        const card = workspace.uiCards.find(
          (card) => card.id === command.cardId,
        );
        if (!card || card.status !== "active")
          throw fail("Respond to an active card.");
        let value: RegisteredValue["data"];
        try {
          value = cardRegistry
            .get(card.content.type, card.content.version)
            .response(card.content.data, command.cardAction, command.value);
        } catch {
          throw fail("Check the card fields and choose an offered action.");
        }
        if (
          cardRegistry
            .get(card.content.type, card.content.version)
            .assets(card.content.data)
            .some((id) => !workspace.assets.some((a) => a.id === id))
        )
          throw fail("Card assets must belong to this workspace.");
        if (card.content.type === "review") {
          const review = reviewCardSchema.parse(card.content.data);
          if (
            currentVersion(getArtifact(workspace, review.artifactId)).number !==
            review.version
          )
            throw fail("This review card refers to an older version.");
          if (command.cardAction === "approve")
            approveVersion(
              workspace,
              actor,
              review.artifactId,
              review.version,
              String(value),
              now,
            );
          else invalidate(workspace, review.artifactId);
        }
        card.response = value;
        card.responseAction = command.cardAction;
        card.status = "answered";
        card.answeredAt = now;
        invalidateDecisions(workspace);
        break;
      }
      case "reopen-card": {
        const card = workspace.uiCards.find(
          (card) => card.id === command.cardId,
        );
        if (
          !card ||
          card.status !== "answered" ||
          card.content.type === "review"
        )
          throw fail(
            "Only answered decision or information cards can be reopened.",
          );
        card.status = "superseded";
        workspace.uiCards.push({
          ...card,
          id: command.key,
          replacesCardId: card.id,
          status: "active",
          response: null,
          responseAction: null,
          answeredAt: null,
          createdAt: now,
        });
        invalidateDecisions(workspace);
        break;
      }
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
          replacesCardId: card.id,
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
        approveVersion(
          workspace,
          actor,
          command.artifactId,
          command.version,
          command.reason,
          now,
        );
        break;
      }
      case "pause":
        workspace.paused = command.paused;
        break;
      case "batch": {
        if (command.profiles && command.profiles.length !== command.count)
          throw fail("Choose one execution profile for each candidate.");
        if (workspace.paused)
          throw fail("Resume the workspace before creating a batch.");
        checkSources(workspace, command.dependencies);
        const target = command.targetId
          ? getArtifact(workspace, command.targetId)
          : null;
        if (command.capability === "workspace-review" && !target)
          throw fail("Choose an artifact to review.");
        const referenceAssetIds = command.referenceAssetIds ?? [];
        if (
          new Set(referenceAssetIds).size !== referenceAssetIds.length ||
          (referenceAssetIds.length && command.capability !== "workspace-image")
        )
          throw fail(
            "Choose distinct private image references for an image task.",
          );
        const editAssetId =
          command.capability === "workspace-image" && target
            ? currentVersion(target).assetId
            : null;
        if (command.capability === "workspace-image" && target && !editAssetId)
          throw fail(
            "Choose an image artifact to edit, or generate a new image.",
          );
        const imageIds = [
          ...new Set([
            ...referenceAssetIds,
            ...(editAssetId ? [editAssetId] : []),
          ]),
        ];
        if (
          imageIds.some(
            (assetId) =>
              !workspace.assets.some(
                (asset) => asset.id === assetId && asset.mime === "image/png",
              ),
          ) ||
          (imageIds.length &&
            (await db.collection("workspaceAssets").countDocuments(
              {
                _id: { $in: imageIds } as never,
                uid: actor.uid,
                workspaceId: id,
                mime: "image/png",
              },
              { session },
            )) !== imageIds.length)
        )
          throw fail("Choose available private images from this workspace.");
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
        const context = JSON.stringify({
          conversation: await recentConversationContext(
            db,
            actor.uid,
            id,
            session,
          ),
          assets: workspace.assets
            .filter((a) => a.mime.startsWith("image/"))
            .map((a) => ({ id: a.id, name: a.name })),
          decisions: workspace.cards
            .filter((c) => c.status === "answered")
            .map((c) => ({ question: c.question.title, answer: c.answer })),
          generatedDecisions: workspace.uiCards
            .filter(
              (c) =>
                c.status === "answered" &&
                ["submit", "choose"].includes(c.responseAction ?? ""),
            )
            .map((c) => ({ card: c.content, answer: c.response })),
          sources: dependencies.map((d) => ({
            id: d.artifactId,
            ...currentVersion(getArtifact(workspace, d.artifactId)),
          })),
        });
        if (context.length > 40000)
          throw fail(
            "The selected context is too large. Choose fewer or shorter sources.",
          );
        const requests: Request[] = [];
        const profiles: (NonNullable<
          WorkspaceView["batches"][number]["items"][number]["profile"]
        > | null)[] = [];
        for (let index = 0; index < command.count; index++) {
          const reference = command.profiles?.[index];
          const profile = reference
            ? await resolveProfile(
                db,
                actor.uid,
                reference,
                command.capability,
                dependencies.length > 0 || imageIds.length > 0,
                session,
              )
            : null;
          profiles.push(
            profile
              ? {
                  id: profile.id,
                  revision: profile.revision,
                  name: profile.name,
                }
              : null,
          );
          const profileContext = profile
            ? JSON.stringify({
                ...JSON.parse(context),
                ...(!profile.includeConversation ? { conversation: "" } : {}),
                ...(!profile.includeDecisions
                  ? { decisions: [], generatedDecisions: [] }
                  : {}),
                executionProfile: {
                  id: profile.id,
                  revision: profile.revision,
                  name: profile.name,
                },
              })
            : context;
          const inputs = selected.parseInput({
            prompt: profile?.instructions
              ? `${profile.instructions}\n\n${command.prompt}`
              : command.prompt,
            context: profileContext,
            ...(command.capability === "workspace-image" && imageIds.length
              ? {
                  referenceAssetIds,
                  editAssetId,
                  referenceUploadScope: command.key,
                }
              : {}),
          });
          if (Buffer.byteLength(JSON.stringify(inputs)) > 64 * 1024)
            throw fail(
              "The selected context exceeds the AI input budget. Choose fewer or shorter sources.",
            );
          requests.push({
            capability: selected.name,
            capabilityVersion: selected.version,
            pricing,
            credits: maximumCredits(pricing),
            binding: bindingSnapshot(
              selected.name,
              aiConfig(),
              profile?.binding ?? undefined,
            ),
            inputs,
            source: {
              type: "workspace",
              id,
              version: String(workspace.revision),
              ...(options.durableIntent
                ? { workflowRunId: options.durableIntent.workflowId }
                : {}),
            },
          });
        }
        workspace.batches.push({
          id: command.key,
          capability: command.capability,
          prompt: command.prompt,
          ...(command.capability === "workspace-image"
            ? { referenceAssetIds, editAssetId }
            : {}),
          dependencies,
          decisions: decisionsHash(workspace),
          targetId: command.targetId,
          selected: null,
          createdAt: now,
          maximumCredits: maximumCredits(pricing) * command.count,
          requests,
          intents: requests.map(() => false),
          items: requests.map((_, i) => ({
            profile: profiles[i],
            jobId: fingerprint([actor.uid, `workspace:${command.key}:${i}`]),
            status: "pending",
            error: null,
            output: null,
          })),
        });
        break;
      }
      case "retry-candidate": {
        if (workspace.paused)
          throw fail("Resume the workspace before starting a new attempt.");
        const prior = workspace.batches.find((b) => b.id === command.batchId);
        const item = prior?.items[command.index];
        if (!prior || !item || prior.selected !== null)
          throw fail("This candidate cannot start another attempt.");
        checkBatchSources(workspace, prior);
        if (workspace.batches.some((b) => b.retryOf === item.jobId))
          throw fail(
            "This candidate already has a new attempt. Inspect that batch.",
          );
        const job = await aiJobs(db).findOne(
          { _id: item.jobId, uid: actor.uid },
          { session },
        );
        if (!job || !canStartNewAttempt(job))
          throw fail(
            "Only confirmed failed or cancelled work can start a new attempt. Uncertain work requires administrator recovery.",
          );
        const originalRequest = prior.requests[command.index];
        const request = {
          ...originalRequest,
          inputs: originalRequest.inputs.referenceUploadScope
            ? { ...originalRequest.inputs, referenceUploadScope: command.key }
            : originalRequest.inputs,
        };
        if (
          fingerprint(
            request.pricing ?? { mode: "fixed", credits: request.credits },
          ) !== command.pricingKey ||
          fingerprint(capabilityPricing(capability(prior.capability))) !==
            command.pricingKey
        )
          throw fail(
            "Pricing changed. Create a new batch after reviewing current prices.",
          );
        if (item.profile)
          await resolveProfile(
            db,
            actor.uid,
            item.profile,
            prior.capability,
            prior.dependencies.length > 0 ||
              Boolean(prior.referenceAssetIds?.length),
            session,
          );
        const binding = bindingSnapshot(
          request.capability,
          aiConfig(),
          request.binding.name,
        );
        if (
          binding.fingerprint !== request.binding.fingerprint ||
          binding.mode !== request.binding.mode
        )
          throw fail(
            "The provider binding changed. Create a new batch with current configuration.",
          );
        workspace.batches.push({
          ...prior,
          id: command.key,
          retryOf: item.jobId,
          selected: null,
          createdAt: now,
          maximumCredits: request.credits,
          requests: [request],
          intents: [false],
          items: [
            {
              jobId: fingerprint([actor.uid, `workspace:${command.key}:0`]),
              status: "pending",
              error: null,
              output: null,
              profile: item.profile ?? null,
            },
          ],
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
              sourceJobId: job._id,
            });
          else if (output.type === "card") {
            const content = parseCard(output.card, true);
            if (
              cardRegistry
                .get(content.type, content.version)
                .assets(content.data)
                .some(
                  (assetId) => !workspace.assets.some((a) => a.id === assetId),
                )
            )
              throw fail(
                "Generated cards may reference only this workspace's private assets.",
              );
            workspace.uiCards.push({
              id: command.key,
              content,
              status: "active",
              response: null,
              responseAction: null,
              answeredAt: null,
              createdAt: now,
              sourceJobId: job._id,
            });
          } else if (output.type === "artifact") {
            const content = parseArtifact(output.artifact);
            const projection = artifactRegistry
              .get(content.type, content.version)
              .project(content.data);
            saveVersion(
              workspace,
              batch.targetId,
              projection.title,
              projection.text,
              batch.dependencies.filter((d) => d.artifactId !== batch.targetId),
              job._id,
              projection.assetIds[0] ?? null,
              batch.decisions,
              content,
            );
          } else
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
          ensureQualityIssues(workspace);
        } else {
          if (!preparedAsset) throw fail("Image validation is required.");
          addAsset(workspace, preparedAsset);
          await privateAssetStore(db).put(preparedAsset, session);
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
        await privateAssetStore(db).put(preparedAsset, session);
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
        await privateAssetStore(db).put(asset, session);
        break;
      }
    }
    if (
      workspace.cards.length > 100 ||
      workspace.uiCards.length > 200 ||
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
    await appendCommandEvent(db, workspace, command, operationId, session);
    return workspace;
  });
  if (
    command.action === "batch" ||
    command.action === "admit" ||
    command.action === "retry-candidate"
  ) {
    await admitBatch(
      db,
      actor,
      id,
      command.action === "admit" ? command.batchId : command.key,
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
