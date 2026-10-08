import "server-only";

import { AppError } from "@/lib/auth-policy";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { calculateAiCharge } from "@/lib/ai-pricing";
import {
  aiJobIdSchema,
  aiResolutionSchema,
  aiSubmitSchema,
} from "@/lib/contracts/ai";
import { database } from "../mongo";
import { requireSession } from "../session";
import { requireAdmin } from "../admin";
import { aiHistory } from "./history";
import {
  aiConfig,
  bindingSnapshot,
  capability,
  capabilityPricing,
  materializeAiResult,
} from "./capabilities";
import {
  aiFiles,
  createDifyFiles,
  resolveOwnedAiFile,
  uploadOwnedAiFile,
  validateAiFile,
} from "./files";
import {
  aiJobs,
  aiUsage,
  createAiJob,
  resolveAiJob,
  fingerprint,
  type AiJob,
} from "./jobs";

function jobView(job: AiJob) {
  return {
    id: job._id,
    capability: job.capability,
    status: job.status,
    credits: job.credits,
    pricing: job.pricing ?? { mode: "fixed" as const, credits: job.credits },
    chargedCredits:
      job.charge?.credits ??
      (job.status === "succeeded"
        ? job.credits
        : ["failed", "cancelled"].includes(job.status)
          ? 0
          : null),
    capped: job.charge?.capped ?? false,
    simulated: job.binding.mode === "fake",
    cancelRequested: job.cancelRequested,
    conversationId: job.conversationId,
    inputs: job.inputs,
    outputs:
      job.status === "succeeded" ? (job.execution?.outputs ?? null) : null,
    failure: job.failure,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    cleanedAt: job.cleanedAt?.toISOString() ?? null,
  };
}
function checkedId(value: string) {
  const parsed = aiJobIdSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError("AI_INVALID_ID", "Invalid execution ID.");
  return parsed.data;
}

export async function submitAiJob(input: unknown) {
  const session = await requireSession();
  const parsed = aiSubmitSchema.parse(input);
  if (parsed.expectedUid && parsed.expectedUid !== session.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  const selected = capability(parsed.capability);
  const pricing = capabilityPricing(selected);
  if (
    (pricing.mode !== "fixed" || parsed.pricingKey) &&
    parsed.pricingKey !== fingerprint(pricing)
  )
    throw new AppError(
      "AI_PRICE_CHANGED",
      "Pricing changed. Reload and review the current price before submitting.",
      409,
    );
  let inputs;
  try {
    inputs = selected.parseInput(parsed.inputs);
  } catch {
    throw new AppError(
      "AI_INVALID_INPUT",
      "Check the inputs for this AI capability.",
    );
  }
  const binding = bindingSnapshot(selected.name, aiConfig());
  if (
    selected.name === "workspace-image" &&
    (inputs.editAssetId ||
      inputs.referenceUploadScope ||
      (Array.isArray(inputs.referenceAssetIds) &&
        inputs.referenceAssetIds.length))
  )
    throw new AppError(
      "AI_REFERENCE_INVALID",
      "Submit private image references through their owned workspace.",
      409,
    );
  for (const file of selected.files ?? [])
    await resolveOwnedAiFile(
      database(),
      session.uid,
      binding,
      String(inputs[file.input]),
      file.types,
    );
  const job = await createAiJob(
    database(),
    { uid: session.uid, authTime: session.auth_time },
    parsed.key,
    {
      capability: selected.name,
      capabilityVersion: selected.version,
      inputs,
      binding,
      credits: maximumCredits(pricing),
      pricing,
      source: null,
      ...(parsed.conversationId
        ? { conversationId: parsed.conversationId }
        : {}),
    },
  );
  return jobView(job);
}
export async function listMyAiJobs() {
  const session = await requireSession();
  const jobs = await aiJobs(database())
    .find({ uid: session.uid })
    .sort({ createdAt: -1, _id: -1 })
    .limit(25)
    .toArray();
  return jobs.map(jobView);
}
export async function myAiHistory(cursor?: string) {
  const session = await requireSession();
  const page = await aiHistory(database(), { uid: session.uid }, cursor);
  return { jobs: page.rows.map(jobView), next: page.next };
}
export async function getMyAiJob(id: string) {
  const session = await requireSession();
  const job = await aiJobs(database()).findOne({
    _id: checkedId(id),
    uid: session.uid,
  });
  if (!job) throw new AppError("NOT_FOUND", "Execution not found.", 404);
  const usage = await aiUsage(database())
    .find({ jobId: job._id, uid: session.uid })
    .sort({ timestamp: 1 })
    .limit(500)
    .toArray();
  return {
    ...jobView(job),
    usage: usage.map((item) => ({
      scope: item.scope,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      cost: item.cost,
      elapsedMs: item.elapsedMs,
      simulated: item.provider === "fake",
    })),
  };
}
export async function cancelMyAiJob(id: string) {
  const session = await requireSession();
  const job = await aiJobs(database()).findOneAndUpdate(
    {
      _id: checkedId(id),
      uid: session.uid,
      status: {
        $in: ["queued", "dispatching", "running", "paused", "unknown"],
      },
    },
    {
      $set: {
        cancelRequested: true,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!job)
    throw new AppError(
      "AI_NOT_CANCELLABLE",
      "Execution is not available for cancellation.",
      409,
    );
  return jobView(job);
}
export async function listAdminAiUsage() {
  await requireAdmin();
  const records = await aiUsage(database())
    .find()
    .sort({ timestamp: -1, _id: -1 })
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
            (await capability(
              job.capability,
              job.capabilityVersion,
            ).validOutput(job.execution.outputs));
        } catch {
          /* A missing contract cannot authorize a charge. */
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
  const admin = await requireAdmin(true);
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
    (job) =>
      capability(job.capability, job.capabilityVersion).validOutput(
        job.execution?.outputs,
      ),
    new Date(),
    (job, session) =>
      materializeAiResult(database(), job, job.execution!, session),
  );
  return { resolved: true };
}

export async function uploadMyAiFile(
  capabilityName: string,
  key: string,
  file: File,
) {
  const session = await requireSession();
  const selected = capability(capabilityName);
  if (!selected.files?.length)
    throw new AppError(
      "AI_FILES_UNSUPPORTED",
      "This capability does not accept files.",
    );
  const type = validateAiFile(file);
  if (!selected.files.some((item) => item.types.includes(type)))
    throw new AppError(
      "AI_FILE_TYPE",
      "Choose a file type supported by this capability.",
      415,
    );
  const config = aiConfig();
  const binding = bindingSnapshot(selected.name, config);
  const upload =
    config.mode === "live"
      ? createDifyFiles(
          config,
          config.bindings.find((item) => item.name === selected.name)!,
        ).upload
      : async () => ({
          kind: "ok" as const,
          value: { id: crypto.randomUUID() },
        });
  const saved = await uploadOwnedAiFile(
    database(),
    { uid: session.uid, authTime: session.auth_time },
    key,
    binding,
    file,
    upload,
  );
  return {
    id: saved._id,
    name: saved.name,
    type: saved.type,
    bytes: saved.bytes,
    status: saved.status,
    simulated: saved.binding.mode === "fake",
  };
}

export async function listMyAiFiles() {
  const session = await requireSession();
  return (
    await aiFiles(database())
      .find({ uid: session.uid, cleanedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()
  ).map((file) => ({
    id: file._id,
    name: file.name,
    type: file.type,
    bytes: file.bytes,
    status: file.status,
    capability: file.binding.name,
    simulated: file.binding.mode === "fake",
  }));
}
