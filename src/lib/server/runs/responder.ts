import { enqueueNotification } from "../notifications";
import "server-only";
import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { personaAnswerSchema } from "@/lib/contracts/personas";
import { parseUiForm, validateAnswers } from "@/lib/contracts/runs";
import { AppError } from "@/lib/auth-policy";
import { calculateAiCharge } from "@/lib/ai-pricing";
import { aiJobs, createAiJob, type AiJob } from "../ai/jobs";
import { authorizeWorkerAccount } from "../worker-authorization";
import { executionBinding } from "./provider";
import {
  decisionView,
  formSchema,
  submitAuthorizedDecision,
  type Decision,
} from "./service";

export function responderAnswer(
  job: Pick<AiJob, "inputs">,
  outputs: Record<string, unknown> | null,
) {
  if (!outputs) throw new Error("Missing responder output");
  const value =
    typeof outputs.answer === "string"
      ? JSON.parse(outputs.answer)
      : outputs.answer;
  const answer = personaAnswerSchema.parse(value);
  const question = JSON.parse(String(job.inputs.question));
  const form = formSchema.parse(question);
  if (!form.user_actions.some((a) => a.id === answer.action))
    throw new Error("Invalid action");
  if (form.inputs.some((f) => f.type === "file" || f.type === "file-list"))
    throw new Error("Files need a human");
  if (form.form_content.includes("```unibase-ui")) {
    const ui = parseUiForm(form.form_content);
    // These cards have no answer value. An offered action acknowledges them;
    // models commonly omit their keys rather than spelling out JSON null.
    // Never invent a choice, field value, file or human approval.
    for (const card of ui.cards)
      if (
        ["summary", "issue"].includes(card.content.type) &&
        !Object.hasOwn(answer.answers, card.id)
      )
        answer.answers[card.id] = null;
    validateAnswers(ui, answer.answers);
  } else {
    if (
      Object.keys(answer.answers).some(
        (k) => !form.inputs.some((f) => f.output_variable_name === k),
      )
    )
      throw new Error("Unknown field");
    for (const f of form.inputs) {
      const v =
        answer.answers[f.output_variable_name] ??
        form.resolved_default_values[f.output_variable_name];
      if (
        typeof v !== "string" ||
        v.length > 4000 ||
        (f.type === "select" &&
          !(f.options ?? f.option_source?.value ?? []).includes(v))
      )
        throw new Error("Invalid field");
    }
  }
  return answer;
}
export async function responderCharges(db: Db, job: AiJob) {
  if (!job.run?.answerer) return 0;
  const children = await aiJobs(db)
    .find({ "responder.parentId": job._id })
    .limit(101)
    .toArray();
  if (
    children.some(
      (c) => !["succeeded", "failed", "cancelled"].includes(c.status),
    )
  )
    throw new AppError(
      "RESPONDER_PENDING",
      "Responder execution needs reconciliation.",
      409,
    );
  let total = 0;
  for (const c of children)
    if (c.status === "succeeded") {
      const charge = calculateAiCharge(
        job.run.answerer.pricing,
        c.execution?.usage ?? null,
      );
      if (!charge)
        throw new AppError(
          "AI_USAGE_MISSING",
          "Responder billing usage is unavailable.",
          409,
        );
      total += charge.credits;
    }
  return total;
}
// Existing worker loop calls this between execution cycles. No browser session is used.
export async function processOneAutomaticDecision(
  db: Db,
  authorize = authorizeWorkerAccount,
) {
  const parents = await aiJobs(db)
    .find({
      "run.answerer.id": { $exists: true },
      status: { $nin: ["succeeded", "failed", "cancelled"] },
    })
    .limit(100)
    .toArray();
  for (const parent of parents) {
    const stop =
      parent.cancelRequested ||
      parent.run?.takenOver ||
      !(await authorize(parent.uid, parent.authTime));
    if (stop)
      await aiJobs(db).updateMany(
        {
          "responder.parentId": parent._id,
          status: { $nin: ["succeeded", "failed", "cancelled"] },
        },
        { $set: { cancelRequested: true, nextAttemptAt: new Date() } },
      );
    if (stop || !["running", "paused"].includes(parent.status)) continue;
    const decision = await db
      .collection<Decision & { responderId?: string }>("runDecisions")
      .findOne(
        {
          jobId: parent._id,
          status: "pending",
          automaticError: { $exists: false },
        },
        { sort: { createdAt: 1 } },
      );
    if (!decision) continue;
    try {
      const view = await decisionView(decision, parent, db);
      if (view.status !== "pending") {
        if (["invalid", "expired", "unavailable"].includes(view.status))
          throw new AppError(
            "PERSONA_FALLBACK",
            "This question could not be prepared for automatic answering. Please answer or take over.",
          );
        continue;
      }
      const refreshed = await db
        .collection<Decision>("runDecisions")
        .findOne({ _id: decision._id });
      const form = refreshed?.form;
      if (!form) continue;
      if (
        form.inputs.some((f) => ["file", "file-list"].includes(f.type)) ||
        refreshed.approval?.requireHuman
      )
        throw new AppError(
          "PERSONA_FALLBACK",
          "This question requires a user answer or a file. Please answer or take over.",
        );
      const persona = parent.run!.answerer!;
      let child = decision.responderId
        ? await aiJobs(db).findOne({ _id: decision.responderId })
        : null;
      if (!child) {
        const previous = await db
          .collection<Decision>("runDecisions")
          .find({ jobId: parent._id, status: "submitted" })
          .limit(100)
          .toArray();
        const question = JSON.stringify({
          form_content: form.form_content,
          inputs: form.inputs,
          user_actions: form.user_actions,
          resolved_default_values: form.resolved_default_values,
          answerContracts: form.form_content.includes("```unibase-ui")
            ? Object.fromEntries(
                parseUiForm(form.form_content).cards.map((c) => [
                  c.id,
                  c.content.type === "summary" || c.content.type === "issue"
                    ? "null acknowledgement"
                    : c.content.type === "question"
                      ? "string for text/single choice; array of offered IDs for multiple choice"
                      : c.content.type === "form"
                        ? "object keyed by field ID, respecting each field's constraints"
                        : c.content.type === "gallery"
                          ? "one offered assetId string"
                          : "no response",
                ]),
              )
            : Object.fromEntries(
                form.inputs.map((f) => [
                  f.output_variable_name,
                  f.type === "select"
                    ? "one offered option string"
                    : "text string up to 4000 characters",
                ]),
              ),
        });
        const context = JSON.stringify({
          inputs: Object.fromEntries(
            Object.entries(parent.inputs).filter(
              ([k]) => !k.startsWith("unibase_"),
            ),
          ),
          decisions: previous.map((d) => ({
            title: d.title,
            action: d.intent?.action ?? d.confirmedAction,
            answers: d.intent?.inputs ?? d.confirmedInputs,
          })),
        });
        const instructions = JSON.stringify({
          name: persona.name,
          instructions: persona.instructions,
        });
        if ([question, context, instructions].some((s) => s.length > 4000))
          throw new AppError(
            "PERSONA_FALLBACK",
            "The question or context exceeds the responder's supported size. Please answer or take over.",
          );
        const binding = await executionBinding(
          persona.responder,
          persona.responderRevision,
          db,
        );
        child = await createAiJob(
          db,
          { uid: parent.uid, authTime: parent.authTime },
          `responder:${decision._id}`,
          {
            capability: "persona-responder",
            capabilityVersion: "1",
            binding: binding.snapshot,
            inputs: { persona: instructions, question, context },
            source: { type: "decision", id: decision._id, version: "1" },
            credits: 0,
            responder: {
              parentId: parent._id,
              decisionId: decision._id,
              definition: persona.responder,
              revision: persona.responderRevision,
            },
          },
          new Date(),
          async (session) => {
            const active = await aiJobs(db).findOneAndUpdate(
              {
                _id: parent._id,
                status: { $in: ["running", "paused"] },
                cancelRequested: false,
                "run.takenOver": { $ne: true },
              },
              { $inc: { responderFence: 1 } },
              { session },
            );
            if (
              !active ||
              (await aiJobs(db).countDocuments(
                { "responder.parentId": parent._id },
                { session },
              )) >= persona.maxCalls
            )
              throw new AppError(
                "PERSONA_FALLBACK",
                "Automatic answering stopped or reached this attempt's answer limit. Please answer or take over.",
              );
            const changed = await db
              .collection<Decision>("runDecisions")
              .updateOne(
                {
                  _id: decision._id,
                  status: "pending",
                  responderId: { $exists: false },
                },
                {
                  $set: {
                    responderId: (await import("../ai/jobs")).fingerprint([
                      parent.uid,
                      `responder:${decision._id}`,
                    ]),
                  },
                },
                { session },
              );
            if (!changed.matchedCount) throw new Error("Decision changed.");
          },
        );
        return true;
      }
      if (child.status === "succeeded") {
        const answer = responderAnswer(child, child.execution!.outputs);
        await submitAuthorizedDecision(
          db,
          { uid: parent.uid, auth_time: parent.authTime },
          parent,
          decision,
          { key: randomUUID(), ...answer },
          {
            type: "persona",
            personaId: persona.id,
            personaRevision: persona.revision,
          },
        );
        return true;
      }
      if (["failed", "cancelled"].includes(child.status))
        throw new AppError(
          "PERSONA_FALLBACK",
          "The responder could not provide a valid answer. Please answer or take over.",
        );
    } catch (error) {
      const session = db.client.startSession();
      try {
        await session.withTransaction(async () => {
          const changed = await db
            .collection<Decision>("runDecisions")
            .updateOne(
              { _id: decision._id, status: "pending" },
              {
                $set: {
                  automaticError:
                    error instanceof AppError &&
                    error.code === "PERSONA_FALLBACK"
                      ? error.message
                      : "Automatic answering is unavailable. Please answer or take over.",
                },
              },
              { session },
            );
          if (changed.modifiedCount && parent.run)
            await enqueueNotification(
              db,
              parent.uid,
              `decision-fallback:${decision._id}`,
              "run-decision",
              { runId: parent.run.logicalId },
              session,
            );
        });
      } finally {
        await session.endSession();
      }
      return true;
    }
  }
  return false;
}
