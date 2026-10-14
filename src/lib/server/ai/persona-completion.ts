import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parsePersonaCompletionConfig } from "@/lib/config/persona-completion";
import type { AiJob } from "./jobs";
import type {
  WorkflowProvider,
  ProviderExecution,
  ProviderOutcome,
} from "./types";
import { completionBinding } from "../runs/persona-completion-settings";
import { AppError } from "@/lib/auth-policy";

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const responseSchema = z.object({
  id: z.string().min(1).max(200),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z.array(z.unknown()).optional(),
          function_call: z.unknown().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1)
    .max(1),
  usage: z
    .object({
      prompt_tokens: tokenCount,
      completion_tokens: tokenCount,
      total_tokens: tokenCount,
    })
    .optional(),
});
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("Response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function personaCompletionProvider(
  job: Pick<AiJob, "binding" | "responder">,
  request: typeof fetch = fetch,
): WorkflowProvider {
  const snapshot = job.responder!.completion;
  const current = completionBinding(snapshot.settings, snapshot.revision);
  if (current.fingerprint !== job.binding.fingerprint)
    throw new AppError(
      "AI_CONFIGURATION",
      "Completion credentials changed. Restore the accepted connection to reconcile this attempt.",
      409,
    );
  const config = parsePersonaCompletionConfig(process.env);
  return {
    async start(
      input,
      _observe,
      signal,
    ): Promise<ProviderOutcome<ProviderExecution>> {
      const started = Date.now();
      const settings = snapshot.settings;
      const timeout = AbortSignal.timeout(60_000);
      const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      try {
        response =
          config.mode === "fake"
            ? Response.json({
                id: randomUUID(),
                choices: [
                  { finish_reason: "stop", message: { content: "Approved" } },
                ],
                usage: {
                  prompt_tokens: 20,
                  completion_tokens: 10,
                  total_tokens: 30,
                },
              })
            : await request(`${config.baseUrl}/chat/completions`, {
                method: "POST",
                redirect: "error",
                signal: abort,
                headers: {
                  Authorization: `Bearer ${config.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: settings.model,
                  messages: [
                    { role: "system", content: settings.instructions },
                    { role: "system", content: String(input.inputs.persona) },
                    {
                      role: "user",
                      content: JSON.stringify({
                        question: input.inputs.question,
                        context: input.inputs.context,
                      }),
                    },
                  ],
                  [settings.tokenParameter]: settings.maxOutputTokens,
                  ...(settings.temperature === null
                    ? {}
                    : { temperature: settings.temperature }),
                  stream: false,
                  n: 1,
                }),
              });
      } catch {
        return {
          kind: "unknown",
          failure: abort.aborted ? "timeout" : "transport",
        };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        // Server failures may follow accepted work; do not infer non-execution.
        return {
          kind:
            response.status >= 400 &&
            response.status < 500 &&
            response.status !== 408
              ? "rejected"
              : "unknown",
          failure:
            response.status === 401 || response.status === 403
              ? "authentication"
              : response.status === 429
                ? "rate-limit"
                : "unavailable",
        };
      }
      try {
        const result = responseSchema.parse(await boundedJson(response));
        const choice = result.choices[0];
        const valid =
          choice.finish_reason === "stop" &&
          !!choice.message.content?.trim() &&
          !choice.message.tool_calls?.length &&
          choice.message.function_call === undefined &&
          !choice.message.refusal;
        const usage = result.usage;
        return {
          kind: "ok",
          value: {
            runId: result.id,
            workflowId: null,
            status: valid ? "succeeded" : "failed",
            outputs: valid ? { answer: choice.message.content! } : null,
            failure: valid
              ? null
              : "The completion did not provide a complete text answer.",
            usage: {
              scope: "execution",
              id: result.id,
              inputTokens: usage?.prompt_tokens ?? null,
              outputTokens: usage?.completion_tokens ?? null,
              totalTokens: usage?.total_tokens ?? null,
              cost: null,
              elapsedMs: Date.now() - started,
            },
          },
        };
      } catch {
        return { kind: "unknown", failure: "invalid-response" };
      }
    },
    // Portable Chat Completions has no guaranteed retrieval/cancellation support.
    retrieve: async () => ({ kind: "unknown", failure: "unavailable" }),
    stop: async () => ({ kind: "unknown", failure: "unavailable" }),
  };
}
