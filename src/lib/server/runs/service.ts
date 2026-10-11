import type { Db, Document } from "mongodb";
import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  runStartSchema,
  runCommandSchema,
  runIdSchema,
  decisionSubmitSchema,
  parseUiForm,
  validateAnswers,
  type OrchestratorDefinition,
} from "@/lib/contracts/runs";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { cardRegistry } from "@/lib/runs/cards";
import { database } from "../mongo";
import { requireSession } from "../session";
import { accountAccess } from "../store/access";
import { requireAdmin } from "../admin";
import { readSettings } from "../settings";
import { readWallet } from "../store/credits";
import {
  aiJobs,
  createAiJob,
  canStartNewAttempt,
  fingerprint,
  type AiJob,
} from "../ai/jobs";
import { providerUser } from "../ai/dify";
import {
  createDifyFiles,
  uploadOwnedAiFile,
  resolveOwnedAiFile,
} from "../ai/files";
import { selectedOrchestrator, orchestrators } from "./orchestrators";
import { executionBinding, providerForRun } from "./provider";

type Decision = {
  _id: string;
  uid: string;
  logicalId: string;
  jobId: string;
  nodeId: string;
  title: string;
  token: string;
  status: string;
  createdAt: Date;
  form?: Form;
  intent?: {
    key: string;
    hash: string;
    action: string;
    inputs: Record<string, z.infer<ReturnType<typeof z.json>>>;
  };
  confirmedAction?: string;
  confirmedInputs?: unknown;
  error?: string;
};
const formSchema = z.object({
  form_content: z.string().max(100000),
  inputs: z
    .array(
      z.object({
        type: z.enum(["paragraph", "select", "file", "file-list"]),
        output_variable_name: z.string().max(64),
        options: z.array(z.string()).optional(),
        option_source: z.object({ value: z.array(z.string()) }).optional(),
        number_limits: z.number().int().nonnegative().optional(),
        allowed_file_types: z
          .array(z.enum(["image", "document", "audio", "video", "custom"]))
          .optional(),
        allowed_file_extensions: z.array(z.string().max(32)).optional(),
        allowed_file_upload_methods: z
          .array(z.enum(["local_file", "remote_url"]))
          .optional(),
      }),
    )
    .max(20),
  user_actions: z
    .array(z.object({ id: z.string().max(20), title: z.string().max(100) }))
    .max(20),
  expiration_time: z.number().nullable().optional(),
  resolved_default_values: z.record(z.string(), z.string()).default({}),
});
type Form = z.infer<typeof formSchema>;
export async function ownedAttempt(id: string, logicalId?: string) {
  const actor = await requireSession();
  const job = await aiJobs(database()).findOne({
    _id: runIdSchema.parse(id),
    uid: actor.uid,
    ...(logicalId ? { "run.logicalId": runIdSchema.parse(logicalId) } : {}),
  });
  if (!job?.run) throw new AppError("RUN_NOT_FOUND", "Run unavailable.", 404);
  return { actor, job };
}
async function checkedInputs(
  d: OrchestratorDefinition,
  inputs: Record<string, unknown>,
  uid: string,
  binding: AiJob["binding"],
) {
  if (
    Object.keys(inputs).some(
      (key) => !d.inputs.some((field) => field.name === key),
    )
  )
    throw new AppError("INVALID_INPUT", "Unknown orchestrator input.");
  const result: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
  for (const field of d.inputs) {
    const value = inputs[field.name];
    if (value === undefined || value === "") {
      if (field.required)
        throw new AppError("INVALID_INPUT", `Complete ${field.label}.`);
      continue;
    }
    if (field.kind === "file") {
      const id = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(value);
      await resolveOwnedAiFile(database(), uid, binding, id, [
        "image",
        "document",
        "audio",
        "video",
      ]);
      result[field.name] = id;
    } else if (field.kind === "number")
      result[field.name] = z.number().finite().parse(value);
    else {
      const parsedText = z
        .string()
        .max(field.maxLength ?? 4000)
        .safeParse(value);
      if (!parsedText.success)
        throw new AppError(
          "INVALID_INPUT",
          `Enter at most ${field.maxLength ?? 4000} text characters for ${field.label}.`,
        );
      const text = parsedText.data;
      if (field.kind === "select" && !field.options.includes(text))
        throw new AppError("INVALID_INPUT", "Choose an offered input.");
      result[field.name] = text;
    }
  }
  return result;
}
async function createAttempt(
  input: z.infer<typeof runStartSchema>,
  previous?: AiJob,
  recovery?: { stage: string; data: unknown; diagnostic: boolean },
) {
  const actor = await requireSession();
  const replay = await aiJobs(database()).findOne({
    _id: fingerprint([actor.uid, input.key]),
    uid: actor.uid,
  });
  if (replay?.run) {
    const saved = Object.fromEntries(
      Object.entries(replay.inputs).filter(
        ([name]) => !name.startsWith("unibase_"),
      ),
    );
    if (
      replay.run.orchestrator.id !== input.orchestratorId ||
      fingerprint(saved) !== fingerprint(input.inputs) ||
      replay.run.predecessorId !== (previous?._id ?? null)
    )
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "This request key was already used for different inputs.",
        409,
      );
    return { id: replay.run.logicalId, attemptId: replay._id };
  }
  const { settings, revision: settingsRevision } = await readSettings();
  if (!settings.runs.enabled)
    throw new AppError("AI_DISABLED", "Runs are disabled.", 503);
  const selected = await selectedOrchestrator(input.orchestratorId);
  const d = selected.definition;
  if (
    input.configurationKey !==
    fingerprint([selected.revision, settingsRevision, d])
  )
    throw new AppError(
      "CONFIGURATION_CHANGED",
      "Configuration or pricing changed. Reload and review before starting.",
      409,
    );
  const bound = await executionBinding(d, selected.revision);
  const pricing = d.pricing ?? settings.runs.pricing;
  const values = await checkedInputs(
    d,
    input.inputs,
    actor.uid,
    bound.snapshot,
  );
  const id = fingerprint([actor.uid, input.key]);
  const logicalId = previous?.run?.logicalId ?? id;
  const legacyInputs = d.legacyInputs ?? [
    "unibase_run_id",
    "unibase_attempt_id",
    "unibase_recovery",
  ];
  const job = await createAiJob(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    input.key,
    {
      capability: "orchestrator",
      capabilityVersion: "1",
      binding: bound.snapshot,
      inputs: {
        ...values,
        ...(legacyInputs.includes("unibase_run_id")
          ? { unibase_run_id: logicalId }
          : {}),
        ...(legacyInputs.includes("unibase_attempt_id")
          ? { unibase_attempt_id: id }
          : {}),
        ...(recovery && legacyInputs.includes("unibase_recovery")
          ? {
              unibase_recovery: JSON.stringify({
                version: d.recovery!.version,
                stage: recovery.stage,
                data: recovery.data,
                diagnostic: recovery.diagnostic,
              }),
            }
          : {}),
      },
      source: { type: "run", id: logicalId, version: "1" },
      credits: maximumCredits(pricing),
      pricing,
      run: {
        logicalId,
        attempt: (previous?.run?.attempt ?? 0) + 1,
        predecessorId: previous?._id ?? null,
        orchestrator: d,
        configurationRevision: selected.revision,
        settingsRevision,
        ...settings.runs,
        failureCharging: d.failureCharging ?? settings.runs.failureCharging,
      },
    },
  );
  return { id: logicalId, attemptId: job._id };
}
export async function startRun(input: unknown) {
  return createAttempt(runStartSchema.parse(input));
}
function status(job: AiJob, result?: unknown) {
  if (job.status === "succeeded") return "succeeded";
  if (
    job.status === "failed" &&
    result &&
    typeof result === "object" &&
    "outcome" in result &&
    result.outcome === "partial"
  )
    return "partially completed";
  return {
    queued: "queued",
    dispatching: "starting",
    running: "running",
    paused: "awaiting input",
    unknown: "reconciling",
    "needs-review": "needs-review",
    "settlement-blocked": "needs-review",
    failed: "failed",
    cancelled: "cancelled",
  }[job.status];
}
export async function listRuns(cursor?: string, filter?: string) {
  const actor = await requireSession();
  const query = { uid: actor.uid, "run.logicalId": { $exists: true } };
  const after = cursor
    ? z
        .object({ time: z.iso.datetime(), id: runIdSchema })
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()))
    : null;
  const rows = await aiJobs(database())
    .aggregate<AiJob & { savedResults?: { result: unknown }[] }>([
      { $match: query },
      { $sort: { "run.attempt": -1 } },
      { $group: { _id: "$run.logicalId", job: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$job" } },
      ...(after
        ? [
            {
              $match: {
                $or: [
                  { createdAt: { $lt: new Date(after.time) } },
                  { createdAt: new Date(after.time), _id: { $lt: after.id } },
                ],
              },
            },
          ]
        : []),
      {
        $lookup: {
          from: "runResults",
          localField: "_id",
          foreignField: "_id",
          as: "savedResults",
        },
      },
      ...(filter
        ? [
            {
              $match: {
                ...(filter === "partial"
                  ? {
                      status: "failed",
                      "savedResults.result.outcome": "partial",
                    }
                  : {
                      status: z
                        .enum([
                          "queued",
                          "running",
                          "paused",
                          "unknown",
                          "needs-review",
                          "succeeded",
                          "failed",
                          "partial",
                          "cancelled",
                        ])
                        .parse(filter),
                    }),
              },
            },
          ]
        : []),
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: 26 },
    ])
    .toArray();
  return {
    rows: rows.slice(0, 25).map((job) => ({
      id: job.run!.logicalId,
      name: job.run!.orchestrator.name,
      status: status(job, job.savedResults?.[0]?.result),
      attempts: job.run!.attempt,
      createdAt: job.createdAt.toISOString(),
    })),
    next:
      rows.length > 25
        ? Buffer.from(
            JSON.stringify({
              time: rows[24].createdAt.toISOString(),
              id: rows[24]._id,
            }),
          ).toString("base64url")
        : null,
  };
}
async function decisionView(decision: Decision, job: AiJob) {
  let form = decision.form;
  if (decision.status === "pending" && !form) {
    try {
      form = formSchema.parse(
        await (
          await providerForRun(job)
        ).form!(decision.token),
      );
      await database()
        .collection<Decision>("runDecisions")
        .updateOne({ _id: decision._id }, { $set: { form } });
    } catch {
      return {
        id: decision._id,
        title: decision.title,
        status: "unavailable",
        error: "This decision requires reconciliation.",
        cards: [],
        actions: [],
        inputs: [],
      };
    }
  }
  if (!form)
    return {
      id: decision._id,
      title: decision.title,
      status: decision.status,
      cards: [],
      actions: [],
      inputs: [],
    };
  let cards: z.infer<ReturnType<typeof z.json>> = [];
  try {
    if (form.form_content.includes("```unibase-ui")) {
      if (
        form.inputs.length !== 1 ||
        form.inputs[0].type !== "paragraph" ||
        form.inputs[0].output_variable_name !== "response"
      )
        throw new Error("Invalid structured response input");
      cards = parseUiForm(form.form_content).cards;
    }
    for (const card of cards as ReturnType<typeof parseUiForm>["cards"])
      for (const id of cardRegistry
        .get(card.content.type, card.content.version)
        .assets(card.content.data))
        if (
          !(await database()
            .collection<Document & { _id: string }>("runAssets")
            .findOne({
              _id: id,
              uid: job.uid,
              logicalId: job.run!.logicalId,
              status: "ready",
            }))
        )
          throw new Error("Unavailable image");
  } catch {
    return {
      id: decision._id,
      title: decision.title,
      status: "invalid",
      error: "Dify returned an unsupported UI definition.",
      cards: [],
      actions: [],
      inputs: [],
    };
  }
  return {
    id: decision._id,
    attemptId: decision.jobId,
    title: decision.title,
    status:
      decision.status === "pending" &&
      !["running", "paused"].includes(job.status)
        ? "closed"
        : decision.status === "pending" &&
            form.expiration_time &&
            form.expiration_time * 1000 < Date.now()
          ? "expired"
          : decision.status,
    cards,
    actions: form.user_actions,
    inputs: form.inputs,
    defaults: form.resolved_default_values,
    structured: form.form_content.includes("```unibase-ui"),
    description: form.form_content.includes("```unibase-ui")
      ? ""
      : form.form_content,
    answers: decision.intent?.inputs ?? decision.confirmedInputs ?? null,
    expiresAt: form.expiration_time ?? null,
  };
}
export async function runDetail(id: string) {
  const actor = await requireSession();
  runIdSchema.parse(id);
  const attempts = await aiJobs(database())
    .find({ uid: actor.uid, "run.logicalId": id })
    .sort({ "run.attempt": 1 })
    .limit(100)
    .toArray();
  if (!attempts.length)
    throw new AppError("RUN_NOT_FOUND", "Run unavailable.", 404);
  const current = attempts[attempts.length - 1];
  const results = await database()
    .collection<Document & { _id: string }>("runResults")
    .find({
      uid: actor.uid,
      _id: {
        $in: attempts
          .filter((j) =>
            ["succeeded", "failed", "cancelled", "settlement-blocked"].includes(
              j.status,
            ),
          )
          .map((j) => j._id),
      },
    })
    .toArray();
  const decisions = await database()
    .collection<Decision>("runDecisions")
    .find({ uid: actor.uid, logicalId: id })
    .limit(100)
    .toArray();
  const events = await database()
    .collection<Document & { _id: string }>("runEvents")
    .find({ uid: actor.uid, logicalId: id })
    .sort({ timestamp: 1, _id: 1 })
    .limit(500)
    .toArray();
  const configs = await orchestrators();
  const choice = configs.find((d) => d.id === current.run!.orchestrator.id);
  return {
    id,
    name: current.run!.orchestrator.name,
    status: status(current, results.find((r) => r._id === current._id)?.result),
    pollSeconds: current.run!.pollSeconds,
    isAdmin: (await accountAccess(database(), actor.uid)).role === "admin",
    attempts: attempts.map((job) => ({
      id: job._id,
      number: job.run!.attempt,
      status: status(job, results.find((r) => r._id === job._id)?.result),
      failure: job.failure,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      credits: job.credits,
      chargedCredits: job.charge?.credits ?? null,
      cancelRequested: job.cancelRequested,
      elapsedSeconds: Math.max(
        0,
        Math.floor(
          ((["succeeded", "failed", "cancelled"].includes(job.status)
            ? job.updatedAt
            : new Date()
          ).getTime() -
            job.createdAt.getTime()) /
            1000,
        ),
      ),
      inputs: Object.fromEntries(
        Object.entries(job.inputs).filter(
          ([key]) => !key.startsWith("unibase_"),
        ),
      ),
      result: results.find((r) => r._id === job._id)?.result ?? null,
    })),
    events: events.map((e) => ({
      id: e._id,
      attemptId: e.jobId,
      event: e.event,
      timestamp: e.timestamp.toISOString(),
    })),
    decisions: await Promise.all(
      decisions.map((d) =>
        decisionView(
          d,
          attempts.find((j) => j._id === d.jobId)!,
        ),
      ),
    ),
    canRestart: canStartNewAttempt(current) && !current.runSuccessorId,
    configuration: choice ?? null,
  };
}
export async function runCommand(id: string, input: unknown) {
  const command = runCommandSchema.parse(input);
  const { actor, job } = await ownedAttempt(command.attemptId, id);
  if (command.action === "cancel") {
    await readWallet(database(), actor.uid, {
      actor: { uid: actor.uid, authTime: actor.auth_time },
      persist: async (session) => {
        const result = await aiJobs(database()).updateOne(
          {
            _id: job._id,
            uid: actor.uid,
            status: {
              $in: ["queued", "dispatching", "running", "paused", "unknown"],
            },
          },
          { $set: { cancelRequested: true, nextAttemptAt: new Date() } },
          { session },
        );
        if (!result.matchedCount)
          throw new AppError(
            "RUN_CONFLICT",
            "Attempt cannot be cancelled.",
            409,
          );
      },
    });
    return { id };
  }
  const choices = await orchestrators();
  const choice = choices.find((d) => d.id === job.run!.orchestrator.id);
  if (!choice || !command.configurationKey)
    throw new AppError(
      "ORCHESTRATOR_UNAVAILABLE",
      "Reload the available configuration.",
      409,
    );
  let recovery;
  if (command.action !== "restart") {
    if (command.action === "test-stage") await requireAdmin(true);
    const saved = await database()
      .collection<Document & { _id: string }>("runResults")
      .findOne({ _id: job._id, uid: actor.uid });
    const checkpoint = saved?.result?.checkpoint;
    const config = await selectedOrchestrator(job.run!.orchestrator.id);
    const supported = config.definition.recovery;
    if (
      !supported ||
      !command.stage ||
      !supported.stages.includes(command.stage) ||
      (command.action === "test-stage" && !supported.diagnostic) ||
      (command.action === "recover" &&
        (!checkpoint ||
          checkpoint.version !== supported.version ||
          checkpoint.stage !== command.stage))
    )
      throw new AppError(
        "RECOVERY_UNAVAILABLE",
        "This stage has no compatible recovery entry point. Restart the run.",
        409,
      );
    recovery = {
      stage: command.stage,
      data: checkpoint?.data ?? {},
      diagnostic: command.action === "test-stage",
    };
  }
  return createAttempt(
    {
      key: command.key,
      orchestratorId: job.run!.orchestrator.id,
      configurationKey: command.configurationKey,
      inputs:
        command.inputs ??
        Object.fromEntries(
          Object.entries(job.inputs).filter(
            ([key]) => !key.startsWith("unibase_"),
          ),
        ),
    },
    job,
    recovery,
  );
}
export async function submitDecision(
  logicalId: string,
  id: string,
  input: unknown,
) {
  const actor = await requireSession();
  const parsed = decisionSubmitSchema.parse(input);
  const collection = database().collection<Decision>("runDecisions");
  const decision = await collection.findOne({
    _id: runIdSchema.parse(id),
    logicalId: runIdSchema.parse(logicalId),
    uid: actor.uid,
  });
  if (!decision)
    throw new AppError("DECISION_NOT_FOUND", "Decision unavailable.", 404);
  const { job } = await ownedAttempt(decision.jobId, logicalId);
  const view = await decisionView(decision, job);
  const refreshed = await collection.findOne({ _id: id });
  const form = refreshed?.form;
  if (!form || ["invalid", "expired", "unavailable"].includes(view.status))
    throw new AppError("DECISION_UNAVAILABLE", "Decision is unavailable.", 409);
  if (!form.user_actions.some((action) => action.id === parsed.action))
    throw new AppError("INVALID_ACTION", "Choose an offered action.");
  let inputs: Record<string, z.infer<ReturnType<typeof z.json>>> = {};
  if (form.form_content.includes("```unibase-ui")) {
    try {
      inputs = {
        response: JSON.stringify(
          validateAnswers(parseUiForm(form.form_content), parsed.answers),
        ),
      };
    } catch {
      throw new AppError(
        "INVALID_INPUT",
        "Complete the offered fields with valid values.",
        400,
      );
    }
  } else {
    if (
      Object.keys(parsed.answers).some(
        (name) =>
          !form.inputs.some((field) => field.output_variable_name === name),
      )
    )
      throw new AppError("INVALID_INPUT", "Unknown form field.");
    for (const field of form.inputs) {
      const value =
        parsed.answers[field.output_variable_name] ??
        form.resolved_default_values[field.output_variable_name];
      if (field.type === "paragraph")
        inputs[field.output_variable_name] = z
          .string()
          .max(4000)
          .parse(value ?? "");
      else if (field.type === "select") {
        const text = z.string().parse(value);
        if (!(field.options ?? field.option_source?.value ?? []).includes(text))
          throw new AppError("INVALID_INPUT", "Choose an offered option.");
        inputs[field.output_variable_name] = text;
      } else {
        if (
          field.allowed_file_upload_methods?.length &&
          !field.allowed_file_upload_methods.includes("local_file")
        )
          throw new AppError(
            "INVALID_INPUT",
            "This form requires an unsupported file transfer method.",
          );
        const ids =
          field.type === "file-list"
            ? z
                .array(runIdSchema)
                .min(1)
                .max(Math.min(10, field.number_limits ?? 10))
                .parse(value)
            : [runIdSchema.parse(value)];
        inputs[field.output_variable_name] = await Promise.all(
          ids.map(async (fileId) => {
            const file = await resolveOwnedAiFile(
              database(),
              actor.uid,
              job.binding,
              fileId,
              field.allowed_file_types?.length &&
                !field.allowed_file_types.includes("custom")
                ? field.allowed_file_types.filter(
                    (t): t is "image" | "document" | "audio" | "video" =>
                      t !== "custom",
                  )
                : ["image", "document", "audio", "video"],
            );
            if (field.allowed_file_extensions?.length) {
              const saved = await database()
                .collection<Document & { _id: string }>("aiFiles")
                .findOne({ _id: fileId, uid: actor.uid });
              const extension = saved?.name?.split(".").at(-1)?.toLowerCase();
              if (
                !extension ||
                !field.allowed_file_extensions.some(
                  (e) => e.replace(/^\./, "").toLowerCase() === extension,
                )
              )
                throw new AppError(
                  "INVALID_INPUT",
                  "This file extension is not allowed.",
                );
            }
            return {
              transfer_method: "local_file",
              upload_file_id: file.upload_file_id,
            };
          }),
        );
        if (field.type === "file")
          inputs[field.output_variable_name] = (
            inputs[field.output_variable_name] as z.infer<
              ReturnType<typeof z.json>
            >[]
          )[0];
      }
    }
  }
  const hash = fingerprint([parsed.action, inputs]);
  if (refreshed?.intent) {
    if (refreshed.intent.key === parsed.key && refreshed.intent.hash === hash)
      return { status: refreshed.status };
    throw new AppError(
      "DECISION_CONFLICT",
      "An answer is already pending or submitted.",
      409,
    );
  }
  await readWallet(database(), actor.uid, {
    actor: { uid: actor.uid, authTime: actor.auth_time },
    persist: async (session) => {
      const active = await aiJobs(database()).findOne(
        {
          _id: job._id,
          uid: actor.uid,
          status: { $in: ["running", "paused"] },
          cancelRequested: false,
        },
        { session },
      );
      if (!active)
        throw new AppError(
          "DECISION_UNAVAILABLE",
          "This attempt no longer accepts answers.",
          409,
        );
      const changed = await collection.updateOne(
        { _id: id, status: "pending", intent: { $exists: false } },
        {
          $set: {
            status: "submitting",
            intent: { key: parsed.key, hash, action: parsed.action, inputs },
          },
        },
        { session },
      );
      if (!changed.matchedCount)
        throw new AppError(
          "DECISION_CONFLICT",
          "Decision changed. Reload.",
          409,
        );
    },
  });
  try {
    await (
      await providerForRun(job)
    ).submit!(decision.token, providerUser(actor.uid), parsed.action, inputs);
    await collection.updateOne(
      { _id: id, "intent.hash": hash, status: "submitting" },
      { $set: { status: "submitted" } },
    );
  } catch {
    await collection.updateOne(
      { _id: id, status: "submitting" },
      { $set: { status: "unknown" } },
    );
  }
  await aiJobs(database()).updateOne(
    { _id: job._id },
    { $set: { nextAttemptAt: new Date() } },
  );
  return { status: (await collection.findOne({ _id: id }))!.status };
}
export async function uploadRunFile(
  logicalId: string,
  attemptId: string,
  key: string,
  file: File,
) {
  const { actor, job } = await ownedAttempt(attemptId, logicalId);
  const d = job.run!.orchestrator;
  const bound = await executionBinding(d, job.run!.configurationRevision);
  const uploaded = await uploadOwnedAiFile(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    key,
    job.binding,
    file,
    job.binding.mode === "fake"
      ? async () => ({ kind: "ok", value: { id: crypto.randomUUID() } })
      : createDifyFiles(bound.config, bound.binding).upload,
  );
  return { id: uploaded._id, status: uploaded.status };
}
export async function prepareRunInputs(job: AiJob, db: Db = database()) {
  const inputs = { ...job.inputs };
  for (const field of job.run!.orchestrator.inputs)
    if (field.kind === "file" && inputs[field.name]) {
      const file = await resolveOwnedAiFile(
        db,
        job.uid,
        job.binding,
        String(inputs[field.name]),
        ["image", "document", "audio", "video"],
      );
      inputs[field.name] = {
        transfer_method: "local_file",
        upload_file_id: file.upload_file_id,
      };
    }
  return inputs;
}
