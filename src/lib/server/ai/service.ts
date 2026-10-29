import "server-only";
import { AppError } from "@/lib/auth-policy";
import { calculateAiCharge } from "@/lib/ai-pricing";
import { aiJobIdSchema, aiResolutionSchema } from "@/lib/contracts/ai";
import { parseResult } from "@/lib/contracts/runs";
import { database } from "../mongo";
import { requireAdmin } from "../admin";
import { aiHistory } from "./history";
import { aiUsage, aiJobs, resolveAiJob } from "./jobs";
import { prepareResult, attachResult } from "../runs/media";
function checkedId(value: string) {
  const parsed = aiJobIdSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError("AI_INVALID_ID", "Invalid attempt ID.");
  return parsed.data;
}
export async function listAdminAiUsage() {
  await requireAdmin();
  const records = await aiUsage(database())
    .find()
    .sort({ timestamp: -1, _id: -1 })
    .limit(100)
    .toArray();
  const jobs = await aiJobs(database())
    .find({ _id: { $in: records.map((r) => r.jobId) } })
    .limit(100)
    .toArray();
  return records.map(
    ({
      _id,
      uid,
      jobId,
      capability: name,
      provider,
      scope,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      elapsedMs,
      timestamp,
    }) => ({
      id: _id,
      uid,
      jobId,
      capability: name,
      provider,
      scope,
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      elapsedMs,
      timestamp: timestamp.toISOString(),
      settledCredits:
        scope === "execution"
          ? (jobs.find((j) => j._id === jobId)?.responderFee ??
            jobs.find((j) => j._id === jobId)?.parentCharge ??
            jobs.find((j) => j._id === jobId)?.charge?.credits ??
            null)
          : null,
      parentAttemptId:
        jobs.find((j) => j._id === jobId)?.responder?.parentId ?? null,
    }),
  );
}

export async function listAdminAiJobs(cursor?: string) {
  await requireAdmin();
  const page = await aiHistory(
    database(),
    { status: { $in: ["needs-review", "settlement-blocked"] } },
    cursor,
    true,
  );
  return {
    next: page.next,
    jobs: await Promise.all(
      page.rows.map(async (job) => {
        let canAccept = false;
        try {
          canAccept =
            job.status !== "settlement-blocked" &&
            job.execution?.status === "succeeded" &&
            calculateAiCharge(
              job.pricing ?? { mode: "fixed", credits: job.credits },
              job.execution.usage,
            ) !== null &&
            parseResult(job.execution.outputs).outcome === "success";
        } catch {
          /* A missing contract cannot authorize a charge. */
        }
        if (job.responder && canAccept) {
          try {
            (await import("../runs/responder")).responderAnswer(
              job,
              job.execution!.outputs,
            );
            const parent = await aiJobs(database()).findOne({
              _id: job.responder.parentId,
            });
            canAccept = Boolean(
              parent?.run?.answerer &&
              calculateAiCharge(
                parent.run.answerer.pricing,
                job.execution!.usage,
              ),
            );
          } catch {
            canAccept = false;
          }
        }
        return {
          id: job._id,
          uid: job.uid,
          capability: job.capability,
          status: job.status,
          credits: job.credits,
          failure: job.failure,
          runId: job.runId,
          canAccept,
          createdAt: job.createdAt.toISOString(),
        };
      }),
    ),
  };
}

export async function resolveManagedAiJob(id: string, input: unknown) {
  const admin = await requireAdmin();
  const parsed = aiResolutionSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "AI_INVALID_RESOLUTION",
      "Provide a resolution, explanation and required acknowledgement.",
    );
  await resolveAiJob(
    database(),
    { uid: admin.uid, authTime: admin.auth_time },
    checkedId(id),
    parsed.data.decision,
    parsed.data.reason,
    async (job) => {
      if (job.responder) {
        try {
          (await import("../runs/responder")).responderAnswer(
            job,
            job.execution?.outputs ?? null,
          );
          const parent = await aiJobs(database()).findOne({
            _id: job.responder.parentId,
          });
          return Boolean(
            parent?.run?.answerer &&
            calculateAiCharge(
              parent.run.answerer.pricing,
              job.execution!.usage,
            ),
          );
        } catch {
          return false;
        }
      }
      if (
        !job.execution ||
        parseResult(job.execution.outputs).outcome !== "success"
      )
        return false;
      await prepareResult(database(), job, job.execution);
      return true;
    },
    new Date(),
    (job, session) => attachResult(database(), job, session),
  );
  return { resolved: true };
}
