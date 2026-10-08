import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import {
  workflowStartSchema,
  workflowActionSchema,
  workflowRunSchema,
  type WorkflowDefinition,
  type WorkflowRunView,
} from "@/lib/contracts/workflow";
import {
  workspaceCommandSchema,
  currentVersion,
  dependenciesCurrent,
  type WorkspaceCommand,
} from "@/lib/contracts/workspace";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { aiJobs, fingerprint } from "../ai/jobs";
import {
  aiConfig,
  bindingSnapshot,
  capability,
  capabilityPricing,
} from "../ai/capabilities";
import {
  commandWorkspace,
  ownedWorkspace,
  workspaceTransaction,
  type Workspace,
} from "./store";
import { resolveProfile } from "./profiles";
import { workspaceEvents } from "./history";
import { repairStartSchema } from "@/lib/contracts/quality";
import { workflowTemplates } from "@/lib/creation/workflows";

export async function startRepair(
  db: Db,
  actor: Actor,
  workspaceId: string,
  input: unknown,
) {
  const request = repairStartSchema.parse(input);
  const workspace = await ownedWorkspace(db, actor.uid, workspaceId);
  const issues = request.issueIds.map((id) => {
    const issue = workspace.qualityIssues.find(
      (item) => item.id === id && item.artifactId === request.artifactId,
    );
    if (!issue)
      throw conflict("Choose findings from the owned target artifact.");
    return issue;
  });
  const template = workflowTemplates.get("draft-review", 1).definition;
  const definition: WorkflowDefinition = {
    ...template,
    type: "targeted-repair",
    title: "Repair selected findings and re-review",
    steps: template.steps.map((step) =>
      step.kind === "checkpoint"
        ? step
        : step.id === "draft"
          ? {
              ...step,
              title: "Repair selected findings",
              target: { kind: "input" },
              profile: request.composeProfile,
              prompt:
                "Revise the target artifact to address only the listed findings. Preserve its registered type and unrelated content. Return only the corrected artifact.",
            }
          : {
              ...step,
              profile: request.reviewProfile,
              prompt:
                "Review the repaired artifact. Check the listed findings and report any remaining or newly introduced problems.",
            },
    ),
  };
  return startWorkflow(
    db,
    actor,
    workspaceId,
    {
      key: request.key,
      expectedUid: request.expectedUid,
      revision: request.revision,
      definition,
      prompt: `Findings to repair:\n${issues.map((issue) => `- ${issue.severity}: ${issue.message}`).join("\n")}\n\n${request.instructions}`,
      sources: [],
      targetId: request.artifactId,
      pricingKeys: {
        "workspace-compose": request.composePricingKey,
        "workspace-review": request.reviewPricingKey,
      },
      maximumCredits: request.maximumCredits,
    },
    { repairIssueIds: request.issueIds },
  );
}
type Actor = { uid: string; authTime: number };
type Source = { artifactId: string; version: number };
type StepState = WorkflowRunView["steps"][number] & {
  command: WorkspaceCommand | null;
  cardIds: string[];
  bindingFingerprint: string | null;
  pricingKey: string | null;
};
export type WorkflowRun = Omit<WorkflowRunView, "steps"> & {
  _id: string;
  uid: string;
  authTime: number;
  startHash: string;
  definition: WorkflowDefinition;
  prompt: string;
  sources: Source[];
  targetId: string | null;
  targetVersion: number | null;
  steps: StepState[];
  lease: string | null;
  leaseUntil: Date;
  nextAt: Date;
};
export const workflowRuns = (db: Db) =>
  db.collection<WorkflowRun>("workspaceWorkflows");
export async function createWorkflowIndexes(db: Db) {
  await workflowRuns(db).createIndex({ uid: 1, workspaceId: 1, createdAt: -1 });
  await workflowRuns(db).createIndex({ status: 1, nextAt: 1, leaseUntil: 1 });
}
const conflict = (message: string) =>
  new AppError("WORKFLOW_CONFLICT", message, 409);
export function workflowView(run: WorkflowRun): WorkflowRunView {
  return workflowRunSchema.parse(run);
}
export async function listWorkflows(db: Db, uid: string, workspaceId: string) {
  await ownedWorkspace(db, uid, workspaceId);
  return (
    await workflowRuns(db)
      .find({ uid, workspaceId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .toArray()
  ).map(workflowView);
}
function verifySources(workspace: Workspace, sources: Source[]) {
  if (!dependenciesCurrent(workspace, sources))
    throw conflict(
      "A source artifact changed. Start a new workflow with current sources.",
    );
}
function uniqueSources(sources: Source[]) {
  const result = new Map<string, Source>();
  for (const source of sources) {
    if (
      result.has(source.artifactId) &&
      result.get(source.artifactId)!.version !== source.version
    )
      throw conflict(
        "Workflow sources contain different versions of the same artifact.",
      );
    result.set(source.artifactId, source);
  }
  return [...result.values()];
}
async function recordEvent(
  db: Db,
  run: WorkflowRun,
  key: string,
  text: string,
  session: ClientSession,
) {
  await workspaceEvents(db).insertOne(
    {
      _id: fingerprint([run.id, key]),
      uid: run.uid,
      workspaceId: run.workspaceId,
      createdAt: new Date(),
      role: "user",
      kind: "workflow",
      parts: [{ type: "text", text }],
    },
    { session },
  );
}
export async function startWorkflow(
  db: Db,
  actor: Actor,
  workspaceId: string,
  input: unknown,
  options: { repairIssueIds?: string[] } = {},
) {
  const command = workflowStartSchema.parse(input);
  if (command.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  return workspaceTransaction(db, actor, async (session) => {
    const hash = fingerprint({
      command,
      repairIssueIds: options.repairIssueIds ?? [],
    });
    const prior = await workflowRuns(db).findOne(
      { _id: command.key },
      { session },
    );
    if (prior) {
      if (
        prior.uid !== actor.uid ||
        prior.workspaceId !== workspaceId ||
        prior.startHash !== hash
      )
        throw conflict("This workflow creation key was already used.");
      return workflowView(prior);
    }
    const workspace = await ownedWorkspace(db, actor.uid, workspaceId, session);
    if (workspace.paused || workspace.revision !== command.revision)
      throw conflict(
        "Refresh the workspace and resume it before starting a workflow.",
      );
    verifySources(workspace, command.sources);
    if (
      command.targetId &&
      !workspace.artifacts.some((a) => a.id === command.targetId)
    )
      throw conflict("Choose an owned target artifact.");
    if (
      (await workflowRuns(db).countDocuments(
        { uid: actor.uid, workspaceId },
        { session },
      )) >= 20
    )
      throw conflict("This workspace supports up to 20 workflow runs.");
    let maximum = 0;
    const steps: StepState[] = [];
    for (const step of command.definition.steps) {
      let bindingFingerprint: string | null = null,
        pricingKey: string | null = null;
      if (step.kind === "task") {
        if (step.target.kind === "input" && !command.targetId)
          throw conflict("This workflow requires a target artifact.");
        const selected = capability(step.capability);
        const pricing = capabilityPricing(selected);
        pricingKey = fingerprint(pricing);
        if (command.pricingKeys[step.capability] !== pricingKey)
          throw conflict(
            "Workflow pricing changed. Reload and review the maximum.",
          );
        maximum += maximumCredits(pricing) * step.count;
        const profile = step.profile
          ? await resolveProfile(
              db,
              actor.uid,
              step.profile,
              step.capability,
              step.dependsOn.length > 0 ||
                command.sources.length > 0 ||
                step.target.kind === "input",
              session,
            )
          : null;
        if (
          (profile?.instructions.length ?? 0) +
            step.prompt.length +
            command.prompt.length +
            4 >
          10000
        )
          throw conflict(
            "Combined profile, step and workflow instructions exceed 10,000 characters.",
          );
        bindingFingerprint = bindingSnapshot(
          step.capability,
          aiConfig(),
          profile?.binding ?? undefined,
        ).fingerprint;
      }
      steps.push({
        id: step.id,
        title: step.title,
        kind: step.kind,
        status: "waiting",
        batchId: null,
        artifacts: [],
        cardIds: [],
        error: null,
        command: null,
        bindingFingerprint,
        pricingKey,
        checkpointBy: null,
        checkpointAt: null,
      });
    }
    if (command.maximumCredits !== maximum)
      throw conflict(
        "Review the current workflow credit maximum before starting.",
      );
    const now = new Date();
    const repairIssueIds = options.repairIssueIds ?? [];
    if (repairIssueIds.length) {
      if (
        await workflowRuns(db).countDocuments(
          {
            uid: actor.uid,
            workspaceId,
            targetId: command.targetId,
            status: { $in: ["active", "paused"] },
            "repairIssueIds.0": { $exists: true },
          },
          { session },
        )
      )
        throw conflict(
          "Finish or cancel the existing repair run for this artifact first.",
        );
      for (const id of repairIssueIds) {
        const issue = workspace.qualityIssues.find(
          (item) => item.id === id && item.artifactId === command.targetId,
        );
        if (!issue || issue.status !== "open")
          throw conflict("Repair only open findings on the target artifact.");
        if (issue.repairRunIds.length >= 3)
          throw conflict(
            "This finding reached its three-repair limit. Revise manually or record an explicit acceptance.",
          );
        if (issue.history.length >= 30)
          throw conflict("This finding reached its history limit.");
        issue.repairRunIds.push(command.key);
        issue.history.push({
          action: "repair",
          uid: actor.uid,
          at: now.toISOString(),
          reason: "Started targeted repair and re-review.",
          version: currentVersion(
            workspace.artifacts.find((a) => a.id === command.targetId)!,
          ).number,
          reviewId: null,
          runId: command.key,
        });
      }
      workspace.revision++;
      workspace.updatedAt = now.toISOString();
      if (Buffer.byteLength(JSON.stringify(workspace)) > 2 * 1024 * 1024)
        throw conflict("This workspace reached its size limit.");
      await db
        .collection<Workspace>("workspaces")
        .replaceOne({ _id: workspaceId, uid: actor.uid }, workspace, {
          session,
        });
    }
    const run: WorkflowRun = {
      _id: command.key,
      id: command.key,
      uid: actor.uid,
      authTime: actor.authTime,
      workspaceId,
      startHash: hash,
      revision: 0,
      title: command.definition.title,
      status: "active",
      definition: command.definition,
      prompt: command.prompt,
      sources: uniqueSources(command.sources),
      targetId: command.targetId,
      targetVersion: command.targetId
        ? currentVersion(
            workspace.artifacts.find((a) => a.id === command.targetId)!,
          ).number
        : null,
      maximumCredits: maximum,
      repairIssueIds,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      steps,
      lease: null,
      leaseUntil: new Date(0),
      nextAt: now,
    };
    await workflowRuns(db).insertOne(run, { session });
    await recordEvent(
      db,
      run,
      "start",
      `Started workflow: ${run.title}. Maximum reservation across its planned tasks: ${maximum} credits.`,
      session,
    );
    return workflowView(run);
  });
}
function stepSources(run: WorkflowRun, index: number) {
  const definition = run.definition.steps[index];
  return uniqueSources(
    definition.dependsOn.length
      ? definition.dependsOn.flatMap(
          (id) => run.steps.find((s) => s.id === id)!.artifacts,
        )
      : run.sources,
  );
}
export async function changeWorkflow(
  db: Db,
  actor: Actor,
  workspaceId: string,
  id: string,
  input: unknown,
) {
  const command = workflowActionSchema.parse(input);
  if (command.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  return workspaceTransaction(db, actor, async (session) => {
    const run = await workflowRuns(db).findOne(
      { _id: id, uid: actor.uid, workspaceId },
      { session },
    );
    if (!run) throw new AppError("NOT_FOUND", "Workflow not found.", 404);
    const operations = db.collection<{ _id: string; hash: string }>(
      "workspaceWorkflowOperations",
    );
    const key = fingerprint([actor.uid, id, command.key]);
    const hash = fingerprint(command);
    const prior = await operations.findOne({ _id: key }, { session });
    if (prior) {
      if (prior.hash !== hash)
        throw conflict("This workflow request key was already used.");
      return workflowView(run);
    }
    if (command.revision !== run.revision)
      throw conflict("The workflow changed. Refresh before continuing.");
    if (["cancelled", "completed"].includes(run.status))
      throw conflict("This workflow has ended.");
    const workspace = await ownedWorkspace(db, actor.uid, workspaceId, session);
    if (command.action === "pause") run.status = "paused";
    if (command.action === "resume") {
      if (workspace.paused) throw conflict("Resume the workspace first.");
      run.status = "active";
      run.authTime = actor.authTime;
      for (const step of run.steps)
        if (step.status === "blocked") {
          step.status = step.batchId ? "running" : "waiting";
          step.error = null;
        }
    }
    if (command.action === "cancel") {
      run.status = "cancelled";
      const batchIds = new Set(
        run.steps.flatMap((step) => (step.batchId ? [step.batchId] : [])),
      );
      const jobIds = workspace.batches
        .filter(
          (batch) =>
            batchIds.has(batch.id) ||
            batch.requests.some(
              (request) => request.source?.workflowRunId === run.id,
            ),
        )
        .flatMap((batch) => batch.items.map((item) => item.jobId));
      await aiJobs(db).updateMany(
        {
          _id: { $in: jobIds },
          uid: actor.uid,
          status: { $nin: ["succeeded", "failed", "cancelled"] },
        },
        { $set: { cancelRequested: true } },
        { session },
      );
    }
    if (command.action === "checkpoint") {
      const index = run.steps.findIndex((step) => step.id === command.stepId);
      const step = run.steps[index];
      const definition = run.definition.steps[index];
      if (
        run.status !== "active" ||
        workspace.paused ||
        !step ||
        definition.kind !== "checkpoint" ||
        step.status !== "awaiting-human"
      )
        throw conflict("This checkpoint is not ready.");
      const sources = stepSources(run, index);
      verifySources(workspace, sources);
      if (
        definition.requireApproval &&
        sources.some(
          (source) =>
            workspace.artifacts.find(
              (artifact) => artifact.id === source.artifactId,
            )?.approval?.version !== source.version,
        )
      )
        throw conflict(
          "Approve the current source artifacts before continuing.",
        );
      step.status = "completed";
      step.artifacts = sources;
      step.checkpointBy = actor.uid;
      step.checkpointAt = new Date().toISOString();
    }
    run.revision++;
    run.updatedAt = new Date().toISOString();
    run.nextAt = new Date();
    // End a lease so a stale scheduler cannot overwrite this human action.
    run.lease = null;
    run.leaseUntil = new Date(0);
    await workflowRuns(db).replaceOne({ _id: id, uid: actor.uid }, run, {
      session,
    });
    await operations.insertOne({ _id: key, hash }, { session });
    await recordEvent(
      db,
      run,
      command.key,
      `${run.title}: ${command.action}${command.stepId ? ` (${command.stepId})` : ""}.`,
      session,
    );
    return workflowView(run);
  });
}
function descendantsBatch(workspace: Workspace, batchId: string) {
  let batch = workspace.batches.find((b) => b.id === batchId);
  const family = batch ? [batch] : [];
  for (let index = 0; index < family.length && index < 50; index++) {
    const jobIds = new Set(family[index].items.map((item) => item.jobId));
    for (const candidate of workspace.batches)
      if (
        candidate.retryOf &&
        jobIds.has(candidate.retryOf) &&
        !family.some((item) => item.id === candidate.id)
      )
        family.push(candidate);
  }
  const selected = family.filter((candidate) => candidate.selected !== null);
  if (selected.length > 1)
    throw conflict(
      "Multiple retry results were selected for this step. Cancel this run and start with the intended artifact as a source.",
    );
  if (selected.length) return { batch: selected[0], family };
  for (
    let count = 0;
    batch && batch.items.length === 1 && count < 50;
    count++
  ) {
    const next = workspace.batches.find(
      (b) => b.retryOf === batch!.items[0].jobId,
    );
    if (!next) break;
    batch = next;
  }
  return { batch, family };
}
function prerequisites(run: WorkflowRun, index: number) {
  const visited = new Set<string>();
  const cardIds: string[] = [];
  const approvals: Source[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const at = run.definition.steps.findIndex((step) => step.id === id);
    const definition = run.definition.steps[at],
      step = run.steps[at];
    cardIds.push(...step.cardIds);
    if (definition.kind === "checkpoint" && definition.requireApproval)
      approvals.push(...step.artifacts);
    definition.dependsOn.forEach(visit);
  };
  run.definition.steps[index].dependsOn.forEach(visit);
  return {
    cardIds: [...new Set(cardIds)],
    approvals: uniqueSources(approvals),
  };
}
export async function processOneWorkflow(
  db: Db,
  options: {
    authorize: (uid: string, authTime: number) => Promise<boolean>;
    now?: () => Date;
  },
) {
  const now = options.now?.() ?? new Date();
  const lease = randomUUID();
  const claimed = await workflowRuns(db).findOneAndUpdate(
    { status: "active", nextAt: { $lte: now }, leaseUntil: { $lte: now } },
    {
      $set: {
        lease,
        leaseUntil: new Date(now.getTime() + 180000),
        nextAt: new Date(now.getTime() + 2000),
      },
    },
    { sort: { nextAt: 1, _id: 1 }, returnDocument: "after" },
  );
  if (!claimed) return false;
  const run = claimed;
  let currentIndex = -1;
  async function persist() {
    run.revision++;
    run.updatedAt = new Date().toISOString();
    const result = await workflowRuns(db).replaceOne(
      { _id: run.id, lease, status: "active" },
      run,
    );
    return result.matchedCount === 1;
  }
  try {
    if (!(await options.authorize(run.uid, run.authTime))) {
      run.status = "paused";
      for (const step of run.steps)
        if (step.status !== "completed")
          step.error =
            "Account access changed. Sign in again before starting new work.";
      await persist();
      return true;
    }
    let workspace = await ownedWorkspace(db, run.uid, run.workspaceId);
    if (workspace.paused) return false;
    for (let index = 0; index < run.steps.length; index++) {
      currentIndex = index;
      const step = run.steps[index],
        definition = run.definition.steps[index];
      if (step.status === "completed" || step.status === "blocked") continue;
      if (step.command) {
        // This exact command was persisted before applying it. Replaying after a
        // crash returns the existing batch/import and never duplicates credits.
        if (
          !(await workflowRuns(db).countDocuments({
            _id: run.id,
            lease,
            status: "active",
          }))
        )
          return false;
        workspace = await commandWorkspace(
          db,
          { uid: run.uid, authTime: run.authTime },
          run.workspaceId,
          step.command,
          {
            durableIntent: {
              workflowId: run.id,
              lease,
              prerequisites:
                step.command.action === "batch"
                  ? prerequisites(run, index)
                  : undefined,
            },
          },
        );
        if (step.command.action === "batch") step.batchId = step.command.key;
        step.command = null;
        step.status = "running";
        step.error = null;
        await persist();
        return true;
      }
      if (
        definition.dependsOn.some(
          (id) => run.steps.find((s) => s.id === id)?.status !== "completed",
        )
      )
        continue;
      if (definition.kind === "checkpoint") {
        if (step.status !== "awaiting-human") {
          step.status = "awaiting-human";
          step.artifacts = stepSources(run, index);
          await persist();
          return true;
        }
        continue;
      }
      if (!step.batchId) {
        let sources = stepSources(run, index);
        let targetId: string | null = null;
        if (definition.target.kind === "input") {
          targetId = run.targetId;
          sources = uniqueSources([
            ...sources,
            { artifactId: run.targetId!, version: run.targetVersion! },
          ]);
        }
        if (definition.target.kind === "step") {
          const targets = run.steps.find(
            (s) =>
              s.id ===
              (definition.target.kind === "step"
                ? definition.target.stepId
                : ""),
          )!.artifacts;
          if (targets.length !== 1)
            throw conflict(
              "The target step must produce exactly one artifact.",
            );
          targetId = targets[0].artifactId;
        }
        verifySources(workspace, sources);
        const config = aiConfig();
        const profile = definition.profile
          ? await db
              .collection<{
                _id: string;
                revision: number;
                binding: string | null;
              }>("executionProfiles")
              .findOne({
                _id: definition.profile.id,
                revision: definition.profile.revision,
              })
          : null;
        const current = bindingSnapshot(
          definition.capability,
          config,
          profile?.binding ?? undefined,
        );
        if (current.fingerprint !== step.bindingFingerprint)
          throw conflict(
            "The accepted provider binding changed. Start a workflow with current configuration.",
          );
        step.command = workspaceCommandSchema.parse({
          key: randomUUID(),
          expectedUid: run.uid,
          revision: workspace.revision,
          action: "batch",
          capability: definition.capability,
          prompt: `${definition.prompt}\n\n${run.prompt}`,
          count: definition.count,
          profiles: Array.from(
            { length: definition.count },
            () => definition.profile,
          ),
          dependencies: sources,
          targetId,
          pricingKey: step.pricingKey,
        });
        await persist();
        return true;
      }
      const { batch, family } = descendantsBatch(workspace, step.batchId);
      if (!batch) throw conflict("The workflow batch is unavailable.");
      step.batchId = batch.id;
      if (batch.selected !== null) {
        const jobId = batch.items[batch.selected].jobId;
        const artifacts = workspace.artifacts.flatMap((artifact) =>
          artifact.versions
            .filter((version) => version.sourceJobId === jobId)
            .map((version) => ({
              artifactId: artifact.id,
              version: version.number,
            })),
        );
        const review = workspace.reviews.find(
          (review) => review.jobId === jobId,
        );
        if (review)
          artifacts.push({
            artifactId: review.artifactId,
            version: review.version,
          });
        if (
          definition.target.kind !== "new" &&
          definition.capability !== "workspace-review" &&
          artifacts.length !== 1
        )
          throw conflict(
            "This step must produce a revised artifact. The selected result did not do so; start a new run with corrected instructions.",
          );
        const cards = workspace.uiCards.filter(
          (card) =>
            card.sourceJobId === jobId &&
            card.content.type !== "review" &&
            card.status !== "superseded",
        );
        const legacy = workspace.cards.filter(
          (card) => card.sourceJobId === jobId && card.status !== "superseded",
        );
        const previous = JSON.stringify({
          status: step.status,
          artifacts: step.artifacts,
          cardIds: step.cardIds,
          error: step.error,
        });
        step.artifacts = uniqueSources(artifacts);
        step.cardIds = [...cards, ...legacy].map((card) => card.id);
        if (
          cards.some((card) => card.status !== "answered") ||
          legacy.some((card) => card.status !== "answered")
        ) {
          step.status = "awaiting-human";
          step.error =
            "Answer the saved card before dependent work can continue.";
        } else {
          step.status = "completed";
          step.error = null;
        }
        if (
          previous !==
          JSON.stringify({
            status: step.status,
            artifacts: step.artifacts,
            cardIds: step.cardIds,
            error: step.error,
          })
        ) {
          await persist();
          return true;
        }
        continue;
      }
      const jobs = await aiJobs(db)
        .find({
          uid: run.uid,
          _id: {
            $in: (definition.selection === "human" ? family : [batch]).flatMap(
              (item) => item.items.map((candidate) => candidate.jobId),
            ),
          },
        })
        .toArray();
      if (jobs.length < batch.items.length) {
        step.status = "blocked";
        step.error =
          "Some candidates were not admitted. Retry pending admission in the batch, then resume this workflow.";
        await persist();
        return true;
      }
      const success = jobs.some(
        (job) => job.status === "succeeded" && !job.cleanedAt,
      );
      if (success && definition.selection === "automatic") {
        step.command = workspaceCommandSchema.parse({
          key: randomUUID(),
          expectedUid: run.uid,
          revision: workspace.revision,
          action: "select",
          batchId: batch.id,
          index: 0,
        });
        await persist();
        return true;
      }
      if (success && definition.selection === "human") {
        if (step.status !== "awaiting-human") {
          step.status = "awaiting-human";
          step.error = "Select a candidate in the batch to continue.";
          await persist();
          return true;
        }
        continue;
      }
      if (
        jobs.every((job) =>
          [
            "failed",
            "cancelled",
            "needs-review",
            "settlement-blocked",
          ].includes(job.status),
        )
      ) {
        step.status = "blocked";
        step.error =
          "Inspect the batch. Only confirmed failures permit a new attempt; uncertain jobs need administrator recovery. Resume afterward.";
        await persist();
        return true;
      }
    }
    if (run.steps.every((step) => step.status === "completed")) {
      run.status = "completed";
      await persist();
      return true;
    }
    return false;
  } catch (error) {
    if (currentIndex >= 0) {
      run.steps[currentIndex].status = "blocked";
      run.steps[currentIndex].error =
        error instanceof AppError
          ? error.message
          : "Scheduling was interrupted. Resume to replay the saved command safely.";
    } else run.status = "paused";
    await persist();
    return true;
  } finally {
    await workflowRuns(db).updateOne(
      { _id: run.id, lease },
      { $set: { lease: null, leaseUntil: new Date(0) } },
    );
  }
}
