import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ClientSession, Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import {
  aiPricingSchema,
  maximumCredits,
  type AiPricing,
} from "@/lib/config/ai-pricing";
import { calculateAiCharge, type AiCharge } from "@/lib/ai-pricing";
import type { CreditActor } from "../store/credit-types";
import {
  accessPermitsSession,
  type AccountAccess,
  type AuditEntry,
} from "../store/access";
import {
  finishManagedReservation,
  readWallet,
  reserveCredits,
} from "../store/credits";
import type {
  Json,
  ProviderEvent,
  ProviderExecution,
  UsageObservation,
} from "./types";

export type BindingSnapshot = {
  name: string;
  revision: string;
  kind: "workflow" | "chat";
  mode: "fake" | "live";
  // Hash of provider origin, app key and publication. Never persist the key.
  fingerprint: string;
};
export type AiJob = {
  _id: string;
  uid: string;
  authTime: number;
  schemaVersion: 1;
  capability: string;
  capabilityVersion: string;
  binding: BindingSnapshot;
  fingerprint: string;
  inputs: Record<string, Json>;
  source: { type: string; id: string; version: string } | null;
  credits: number;
  pricing?: AiPricing;
  charge?: AiCharge & { usage: UsageObservation | null };
  reservationId: string | null;
  status:
    | "queued"
    | "dispatching"
    | "running"
    | "paused"
    | "unknown"
    | "needs-review"
    | "settlement-blocked"
    | "succeeded"
    | "failed"
    | "cancelled";
  runId: string | null;
  taskId: string | null;
  conversationId: string | null;
  providerConversationId: string | null;
  providerWorkflowRunId: string | null;
  execution: ProviderExecution | null;
  lease: string | null;
  leaseUntil: Date;
  attempts: number;
  nextAttemptAt: Date;
  reviewAfter: Date;
  cancelRequested: boolean;
  failure: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type AiUsage = UsageObservation & {
  _id: string;
  uid: string;
  jobId: string;
  runId: string;
  capability: string;
  provider: "dify" | "fake";
  timestamp: Date;
};
export const aiJobs = (db: Db) => db.collection<AiJob>("aiJobs");
export const aiUsage = (db: Db) => db.collection<AiUsage>("aiUsage");
export type AiConversation = {
  _id: string;
  uid: string;
  bindingFingerprint: string;
  providerId: string | null;
  activeJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export const aiConversations = (db: Db) =>
  db.collection<AiConversation>("aiConversations");
const terminal = ["succeeded", "failed", "cancelled"] as const;

function canonical(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
export function fingerprint(value: Json): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function conflict() {
  return new AppError(
    "AI_CONFLICT",
    "The execution changed. Refresh and try again.",
    409,
  );
}

export async function createAiJob(
  db: Db,
  actor: CreditActor,
  key: string,
  request: Pick<
    AiJob,
    | "capability"
    | "capabilityVersion"
    | "binding"
    | "inputs"
    | "source"
    | "credits"
  > & { conversationId?: string; pricing?: AiPricing },
  now = new Date(),
) {
  if (
    !/^[A-Za-z0-9_:-]{1,128}$/.test(key) ||
    !Number.isSafeInteger(request.credits) ||
    request.credits < 0
  )
    throw new AppError("AI_INVALID_REQUEST", "Invalid execution request.");
  if (request.pricing) {
    const pricing = aiPricingSchema.parse(request.pricing);
    if (maximumCredits(pricing) !== request.credits)
      throw new AppError(
        "AI_INVALID_PRICE",
        "Reservation must match the pricing maximum.",
      );
  }
  z.record(z.string(), z.json()).parse(request.inputs);
  if (Buffer.byteLength(JSON.stringify(request.inputs)) > 64 * 1024)
    throw new AppError(
      "AI_INPUT_TOO_LARGE",
      "Execution input is too large.",
      413,
    );
  const jobId = fingerprint([actor.uid, key]);
  const requestHash = fingerprint(request);
  let saved: AiJob | null = null;
  const persist = async (
    session: ClientSession,
    result: { reservationId?: string },
  ) => {
    const prior = await aiJobs(db).findOne({ _id: jobId }, { session });
    if (prior) {
      if (prior.fingerprint !== requestHash)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "This request key was already used for different inputs.",
          409,
        );
      saved = prior;
      return;
    }
    if (
      (await aiJobs(db).countDocuments(
        { uid: actor.uid, status: { $nin: terminal } },
        { session },
      )) >= 5
    )
      throw new AppError(
        "AI_CONCURRENCY_LIMIT",
        "Finish or resolve existing executions before starting another.",
        429,
      );
    let conversationId: string | null = null;
    let providerConversationId: string | null = null;
    if (request.binding.kind === "chat") {
      conversationId = request.conversationId ?? jobId;
      const previous = await aiConversations(db).findOne(
        { _id: conversationId },
        { session },
      );
      if (
        request.conversationId &&
        (!previous ||
          previous.uid !== actor.uid ||
          previous.bindingFingerprint !== request.binding.fingerprint)
      )
        throw new AppError(
          "AI_CONVERSATION_NOT_FOUND",
          "Conversation is unavailable for this capability.",
          404,
        );
      if (previous?.activeJobId)
        throw new AppError(
          "AI_CONVERSATION_BUSY",
          "Resolve the previous message before sending another.",
          409,
        );
      providerConversationId = previous?.providerId ?? null;
      if (previous)
        await aiConversations(db).updateOne(
          { _id: conversationId },
          { $set: { activeJobId: jobId, updatedAt: now } },
          { session },
        );
      else
        await aiConversations(db).insertOne(
          {
            _id: conversationId,
            uid: actor.uid,
            bindingFingerprint: request.binding.fingerprint,
            providerId: null,
            activeJobId: jobId,
            createdAt: now,
            updatedAt: now,
          },
          { session },
        );
    } else if (request.conversationId)
      throw new AppError(
        "AI_CONVERSATION_UNSUPPORTED",
        "This capability does not accept a conversation.",
      );
    saved = {
      ...request,
      _id: jobId,
      uid: actor.uid,
      authTime: actor.authTime,
      schemaVersion: 1,
      fingerprint: requestHash,
      reservationId: result.reservationId ?? null,
      status: "queued",
      runId: null,
      taskId: null,
      conversationId,
      providerConversationId,
      providerWorkflowRunId: null,
      execution: null,
      lease: null,
      leaseUntil: new Date(0),
      attempts: 0,
      nextAttemptAt: now,
      reviewAfter: new Date(now.getTime() + 24 * 3600_000),
      cancelRequested: false,
      failure: null,
      createdAt: now,
      updatedAt: now,
    };
    await aiJobs(db).insertOne(saved, { session });
  };
  if (request.credits)
    await reserveCredits(db, actor, `ai:${jobId}`, request.credits, {
      now,
      managedJobId: jobId,
      persist,
    });
  else await readWallet(db, actor.uid, { actor, now, persist });
  if (!saved) throw conflict();
  return saved as AiJob;
}

export async function claimAiJob(db: Db, now = new Date()) {
  return aiJobs(db).findOneAndUpdate(
    {
      status: {
        $in: ["queued", "dispatching", "running", "paused", "unknown"],
      },
      leaseUntil: { $lte: now },
      nextAttemptAt: { $lte: now },
    },
    {
      $set: {
        lease: randomUUID(),
        leaseUntil: new Date(now.getTime() + 180_000),
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: "after" },
  );
}

function fence(job: AiJob, now: Date) {
  if (!job.lease) throw conflict();
  return {
    _id: job._id,
    lease: job.lease,
    leaseUntil: { $gt: now },
    status: { $nin: terminal },
  };
}
export async function patchAiJob(
  db: Db,
  job: AiJob,
  patch: Partial<
    Pick<
      AiJob,
      | "status"
      | "failure"
      | "runId"
      | "taskId"
      | "providerConversationId"
      | "providerWorkflowRunId"
      | "execution"
      | "lease"
      | "leaseUntil"
      | "nextAttemptAt"
      | "charge"
    >
  >,
  now = new Date(),
  session?: ClientSession,
) {
  const result = await aiJobs(db).findOneAndUpdate(
    fence(job, now),
    { $set: { ...patch, updatedAt: now } },
    { returnDocument: "after", session },
  );
  if (!result) throw conflict();
  return result;
}

export async function persistAiEvent(
  db: Db,
  job: AiJob,
  event: ProviderEvent,
  now = new Date(),
) {
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await patchAiJob(db, job, {}, now, session);
      if (event.type === "identity") {
        if (
          current.providerWorkflowRunId &&
          event.workflowRunId &&
          current.providerWorkflowRunId !== event.workflowRunId
        )
          throw conflict();
        if (
          current.runId &&
          (current.runId !== event.runId || current.taskId !== event.taskId)
        )
          throw conflict();
        if (current.binding.kind === "chat") {
          if (
            !current.conversationId ||
            !event.providerConversationId ||
            (current.providerConversationId &&
              current.providerConversationId !== event.providerConversationId)
          )
            throw conflict();
          const updated = await aiConversations(db).updateOne(
            {
              _id: current.conversationId,
              uid: current.uid,
              activeJobId: current._id,
            },
            {
              $set: {
                providerId: event.providerConversationId,
                updatedAt: now,
              },
            },
            { session },
          );
          if (!updated.matchedCount) throw conflict();
        } else if (event.providerConversationId) throw conflict();
        await patchAiJob(
          db,
          job,
          {
            runId: event.runId,
            taskId: event.taskId,
            status: "running",
            ...(event.providerConversationId
              ? { providerConversationId: event.providerConversationId }
              : {}),
            ...(event.workflowRunId
              ? { providerWorkflowRunId: event.workflowRunId }
              : {}),
          },
          now,
          session,
        );
      } else {
        if (!current.runId) throw conflict();
        if (event.type === "execution") {
          if (event.execution.runId !== current.runId) throw conflict();
          await patchAiJob(
            db,
            job,
            { execution: event.execution },
            now,
            session,
          );
        }
        const usage =
          event.type === "execution" ? event.execution.usage : event.usage;
        const record: AiUsage = {
          ...usage,
          _id: fingerprint([job._id, usage.scope, usage.id]),
          uid: job.uid,
          jobId: job._id,
          runId: current.runId,
          capability: job.capability,
          provider: job.binding.mode === "fake" ? "fake" : "dify",
          timestamp: now,
        };
        // An execution summary is a distinct scope, not an extra billable node.
        // Reconciliation cannot append the same observation twice.
        await aiUsage(db).updateOne(
          { _id: record._id },
          { $setOnInsert: record },
          { upsert: true, session },
        );
        const known = Object.fromEntries(
          Object.entries({
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cost: usage.cost,
            elapsedMs: usage.elapsedMs,
          }).filter(([, value]) => value !== null),
        );
        if (Object.keys(known).length)
          await aiUsage(db).updateOne(
            { _id: record._id },
            { $set: known },
            { session },
          );
      }
    });
  } finally {
    await session.endSession();
  }
}

export async function settleAiJob(
  db: Db,
  job: AiJob,
  status: "succeeded" | "failed" | "cancelled",
  now = new Date(),
  onSettle?: (session: ClientSession) => Promise<void>,
) {
  const saved = await aiJobs(db).findOne({ _id: job._id, uid: job.uid });
  if (!saved) throw conflict();
  const pricing = saved.pricing ?? {
    mode: "fixed" as const,
    credits: saved.credits,
  };
  const usage = saved.execution?.usage ?? null;
  const calculated =
    status === "succeeded"
      ? calculateAiCharge(pricing, usage)
      : { credits: 0, calculatedCredits: "0", capped: false };
  if (!calculated)
    throw new AppError(
      "AI_USAGE_MISSING",
      "Required billing usage is unavailable or has a different currency.",
      409,
    );
  const charge = {
    ...calculated,
    usage: status === "succeeded" ? usage : null,
  };
  const persist = async (session: ClientSession) => {
    const prior = await aiJobs(db).findOne(
      { _id: job._id, uid: job.uid },
      { session },
    );
    if (prior?.status === status) return;
    if (
      !prior ||
      fingerprint(prior.execution?.usage ?? null) !== fingerprint(usage)
    )
      throw conflict();
    if (status === "succeeded" && prior?.execution?.status !== "succeeded")
      throw new AppError(
        "AI_RESULT_UNVERIFIED",
        "A saved successful execution is required before charging credits.",
        409,
      );
    await onSettle?.(session);
    // An operator credit waiver does not establish that an uncertain chat turn
    // ended. Keep that conversation blocked; a new conversation remains possible.
    if (
      prior?.conversationId &&
      (prior.status === "queued" ||
        (status === "failed" && !prior.runId) ||
        (prior.execution &&
          !["running", "paused"].includes(prior.execution.status)))
    )
      await aiConversations(db).updateOne(
        { _id: prior.conversationId, uid: prior.uid, activeJobId: prior._id },
        { $set: { activeJobId: null, updatedAt: now } },
        { session },
      );
    await patchAiJob(
      db,
      job,
      { status, charge, lease: null, leaseUntil: new Date(0) },
      now,
      session,
    );
  };
  if (job.reservationId) {
    await finishManagedReservation(
      db,
      job.uid,
      `ai-settle:${job._id}`,
      job.reservationId,
      status === "succeeded" ? "commit" : "release",
      {
        managedJobId: job._id,
        persist,
        now,
        ...(saved.pricing && status === "succeeded"
          ? { chargeAmount: charge.credits }
          : {}),
      },
    );
  } else await readWallet(db, job.uid, { now, persist });
}

export async function resolveAiJob(
  db: Db,
  admin: CreditActor,
  id: string,
  decision: "accept" | "release",
  reason: string,
  validOutput: (job: AiJob) => boolean,
  now = new Date(),
  onAccept?: (job: AiJob, session: ClientSession) => Promise<void>,
) {
  if (reason.trim().length < 10 || reason.length > 500)
    throw new AppError(
      "AI_RESOLUTION_REASON",
      "Provide an explanation between 10 and 500 characters.",
    );
  const job = await aiJobs(db).findOneAndUpdate(
    {
      _id: id,
      status: { $in: ["needs-review", "settlement-blocked"] },
      leaseUntil: { $lte: now },
    },
    {
      $set: {
        lease: randomUUID(),
        leaseUntil: new Date(now.getTime() + 180_000),
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (!job) throw conflict();
  try {
    if (
      decision === "accept" &&
      (job.execution?.status !== "succeeded" || !validOutput(job))
    )
      throw new AppError(
        "AI_RESULT_UNVERIFIED",
        "Only a saved, validated successful execution can be accepted.",
        409,
      );
    await settleAiJob(
      db,
      job,
      decision === "accept" ? "succeeded" : "cancelled",
      now,
      async (session) => {
        const access = await db
          .collection<AccountAccess>("accountAccess")
          .findOneAndUpdate(
            { _id: admin.uid },
            { $inc: { revision: 1 } },
            { returnDocument: "after", session },
          );
        if (
          !access ||
          access.role !== "admin" ||
          !accessPermitsSession(access, admin.authTime)
        )
          throw new AppError(
            "FORBIDDEN",
            "Administrator access is required.",
            403,
          );
        await db.collection<AuditEntry>("auditEvents").insertOne(
          {
            _id: randomUUID(),
            event: "ai-resolution",
            actorUid: admin.uid,
            targetUid: job.uid,
            reason: `${decision} ${job._id}: ${reason.trim()}`,
            timestamp: now,
          },
          { session },
        );
        if (decision === "accept") await onAccept?.(job, session);
      },
    );
  } catch (error) {
    await aiJobs(db).updateOne(
      { _id: job._id, lease: job.lease },
      { $set: { lease: null, leaseUntil: new Date(0) } },
    );
    throw error;
  }
}

export async function createAiIndexes(db: Db) {
  await aiConversations(db).createIndex({ uid: 1, updatedAt: -1 });
  await aiJobs(db).createIndex({ uid: 1, createdAt: -1, _id: -1 });
  await aiJobs(db).createIndex({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
  await aiJobs(db).createIndex(
    { "binding.fingerprint": 1, runId: 1 },
    { unique: true, partialFilterExpression: { runId: { $type: "string" } } },
  );
  await aiUsage(db).createIndex({ uid: 1, timestamp: -1, _id: -1 });
  await aiUsage(db).createIndex({ jobId: 1, scope: 1 });
}
