import "server-only";

import type { ClientSession, Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { readWallet } from "../store/credits";
import type { Reservation } from "../store/credit-types";
import {
  aiJobs,
  claimAiJob,
  patchAiJob,
  persistAiEvent,
  settleAiJob,
  type AiJob,
} from "./jobs";
import { providerUser } from "./dify";
import type {
  ProviderExecution,
  ProviderOutcome,
  WorkflowProvider,
} from "./types";

export type AiWorkerDependencies = {
  provider: (job: AiJob) => WorkflowProvider;
  authorize: (uid: string, authTime: number) => Promise<boolean>;
  validateOutput: (
    job: AiJob,
    execution: ProviderExecution,
  ) => boolean | Promise<boolean>;
  prepareInput?: (
    job: AiJob,
  ) => Promise<Record<string, import("./types").Json>>;
  materialize?: (
    job: AiJob,
    result: ProviderExecution,
    session: ClientSession,
  ) => Promise<void>;
  now?: () => Date;
};

// Lease exceeds the provider's bounded 120s stream attempt. An expired worker can
// neither publish a result nor charge credits. Recovery reads; it never replays POST.
export async function processOneAiJob(db: Db, deps: AiWorkerDependencies) {
  const now = deps.now ?? (() => new Date());
  let job = await claimAiJob(db, now());
  if (!job) return false;
  async function defer(failure: string, review = false, delay?: number) {
    const current = now();
    const needsReview = review || current >= job!.reviewAfter;
    await patchAiJob(
      db,
      job!,
      {
        status: needsReview
          ? "needs-review"
          : job!.execution?.status === "paused"
            ? "paused"
            : "unknown",
        failure,
        lease: null,
        leaseUntil: new Date(0),
        nextAttemptAt: new Date(
          current.getTime() +
            (delay ??
              Math.min(300_000, 2000 * 2 ** Math.min(job!.attempts, 8))),
        ),
      },
      current,
    );
  }
  async function finish(execution: ProviderExecution) {
    if (["running", "paused"].includes(execution.status)) {
      job = await patchAiJob(
        db,
        job!,
        { status: execution.status as "running" | "paused", execution },
        now(),
      );
      await patchAiJob(
        db,
        job,
        {
          lease: null,
          leaseUntil: new Date(0),
          nextAttemptAt: new Date(now().getTime() + 5000),
        },
        now(),
      );
      return;
    }
    if (execution.status === "partial-succeeded") {
      await defer("partial-success", true);
      return;
    }
    if (execution.status === "succeeded") {
      if (!(await deps.validateOutput(job!, execution))) {
        await defer("invalid-output", true);
        return;
      }
      await settleAiJob(
        db,
        job!,
        "succeeded",
        now(),
        deps.materialize
          ? (session) => deps.materialize!(job!, execution, session)
          : undefined,
      );
    } else
      await settleAiJob(
        db,
        job!,
        execution.status === "stopped" ? "cancelled" : "failed",
        now(),
      );
  }
  try {
    // Recover saved terminal evidence before contacting the provider again.
    if (
      job.execution &&
      !["running", "paused"].includes(job.execution.status)
    ) {
      await finish(job.execution);
      return true;
    }
    if (now() >= job.reviewAfter) {
      await defer("reconciliation-deadline", true);
      return true;
    }
    if (job.status === "queued" && job.cancelRequested) {
      await settleAiJob(db, job, "cancelled", now());
      return true;
    }
    const provider = deps.provider(job);
    let outcome: ProviderOutcome<ProviderExecution>;
    const starting = job.status === "queued";
    if (starting) {
      if (!(await deps.authorize(job.uid, job.authTime))) {
        await settleAiJob(db, job, "cancelled", now());
        return true;
      }
      const claimed = job;
      const inputs = deps.prepareInput
        ? await deps.prepareInput(job)
        : job.inputs;
      await readWallet(db, job.uid, {
        actor: { uid: job.uid, authTime: job.authTime },
        now: now(),
        persist: async (session) => {
          const current = await aiJobs(db).findOne(
            { _id: claimed._id },
            { session },
          );
          if (current?.cancelRequested)
            throw new AppError("AI_CANCELLED", "Execution cancelled.", 409);
          if (claimed.reservationId) {
            const hold = await db
              .collection<Reservation>("creditReservations")
              .findOne(
                {
                  _id: claimed.reservationId,
                  uid: claimed.uid,
                  managedJobId: claimed._id,
                  status: "active",
                },
                { session },
              );
            if (!hold)
              throw new AppError(
                "AI_CANCELLED",
                "Execution credits are no longer reserved.",
                409,
              );
          }
          job = await patchAiJob(
            db,
            claimed,
            { status: "dispatching" },
            now(),
            session,
          );
        },
      });
      outcome = await provider.start(
        { user: providerUser(job.uid), inputs },
        async (event) => {
          await persistAiEvent(db, job!, event, now());
        },
      );
    } else if (job.runId) {
      if (job.cancelRequested && job.taskId)
        await provider.stop(job.taskId, providerUser(job.uid));
      outcome = await provider.retrieve(job.runId);
    } else {
      await defer("acceptance-unknown", true);
      return true;
    }
    // Event writes may have supplied identity, outputs and new cancellation state.
    job = (await aiJobs(db).findOne({ _id: job._id, lease: job.lease })) ?? job;
    if (outcome.kind === "ok") {
      await persistAiEvent(
        db,
        job,
        { type: "execution", execution: outcome.value },
        now(),
      );
      await finish(outcome.value);
    } else if (starting && outcome.kind === "rejected" && !job.runId) {
      await patchAiJob(db, job, { failure: outcome.failure }, now());
      await settleAiJob(db, job, "failed", now());
    } else {
      if (outcome.evidence)
        await persistAiEvent(
          db,
          job,
          { type: "execution", execution: outcome.evidence },
          now(),
        );
      await defer(outcome.failure, !job.runId, outcome.retryAfterMs);
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_USAGE_MISSING")
      await defer("usage-unavailable", true);
    else if (
      error instanceof AppError &&
      ["FORBIDDEN", "AI_CANCELLED"].includes(error.code) &&
      job.status === "queued"
    )
      await settleAiJob(db, job, "cancelled", now());
    else if (error instanceof AppError && error.code === "RESERVATION_CLOSED")
      await patchAiJob(
        db,
        job,
        {
          status: "settlement-blocked",
          failure: "reservation-closed",
          lease: null,
          leaseUntil: new Date(0),
        },
        now(),
      );
    else if (now() >= job.reviewAfter) {
      // Saved successful provider evidence can still fail product materialization.
      // Escalate that failure as well; otherwise the early recovery branch above
      // would retry a permanently stale source forever, keeping its credits held.
      await defer("settlement-failed", true);
    } else {
      // Keep the original lease on DB failures. The next worker must recover from
      // persisted dispatch intent; a caught exception never authorizes re-dispatch.
      throw error;
    }
  }
  return true;
}
