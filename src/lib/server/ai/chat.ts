import "server-only";

import { z } from "zod";
import {
  createDifyRequest,
  failure,
  httpFailure,
  parseUsage,
  readJson,
  type Binding,
  type LiveConfig,
} from "./dify";
import { readSse } from "./sse";
import type {
  ProviderEvent,
  ProviderExecution,
  WorkflowProvider,
} from "./types";

const id = z.string().uuid();

// The durable job's runId is the message ID for chat, not a workflow-run ID.
// Conversation ownership is checked by the application before constructing this
// adapter. Chat retrieval always includes the same stable provider user.
export function createDifyChat(
  config: LiveConfig,
  binding: Binding,
  context: {
    user: string;
    conversationId: string | null;
    workflowRunId?: string | null;
  },
  fetcher: typeof fetch = fetch,
): WorkflowProvider {
  if (binding.kind !== "chat") throw new Error("A chat binding is required.");
  const request = createDifyRequest(config, binding, fetcher);
  let conversationId = context.conversationId;
  let workflowRunId = context.workflowRunId ?? null;
  return {
    async start(input, observe, signal) {
      if (input.user !== context.user) throw new Error("Chat user changed.");
      const { prompt, files, ...variables } = input.inputs;
      let response: Response;
      try {
        response = await request(
          "/chat-messages",
          {
            inputs: variables,
            query: prompt,
            ...(files === undefined ? {} : { files }),
            user: input.user,
            conversation_id: conversationId ?? "",
            response_mode: "streaming",
            auto_generate_name: false,
          },
          signal,
        );
      } catch (error) {
        return { kind: "unknown", failure: failure(error) };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return httpFailure(response, true);
      }
      if (
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      ) {
        await response.body?.cancel().catch(() => undefined);
        return { kind: "unknown", failure: "invalid-response" };
      }
      let messageId: string | undefined;
      let taskId: string | undefined;
      let persistedWorkflowRunId: string | null = null;
      let identityPersisted = false;
      let text = "";
      let persistenceFailed = false;
      let agentChunks = false;
      let messageResult: ProviderExecution | null = null;
      async function emit(event: ProviderEvent) {
        try {
          await observe(event);
        } catch (error) {
          persistenceFailed = true;
          throw error;
        }
      }
      try {
        for await (const raw of readSse(response.body)) {
          const event = z
            .object({
              event: z.string(),
              message_id: id.optional(),
              id: id.optional(),
              task_id: id.optional(),
              conversation_id: id.optional(),
              workflow_run_id: id.optional(),
              data: z.unknown().optional(),
              answer: z.string().optional(),
              metadata: z.object({ usage: z.unknown().optional() }).optional(),
            })
            .parse(raw);
          if (event.event === "error")
            return { kind: "unknown", failure: "unavailable" };
          if (event.workflow_run_id) {
            if (workflowRunId && workflowRunId !== event.workflow_run_id)
              throw new Error("Workflow run changed.");
            workflowRunId = event.workflow_run_id;
          }
          const candidate =
            event.message_id ??
            ([
              "message",
              "message_end",
              "message_replace",
              "agent_message",
            ].includes(event.event)
              ? event.id
              : undefined);
          if (candidate && event.task_id && event.conversation_id) {
            if (
              (messageId && messageId !== candidate) ||
              (taskId && taskId !== event.task_id) ||
              (conversationId && conversationId !== event.conversation_id)
            )
              throw new Error("Chat identity changed.");
            if (!messageId) {
              messageId = candidate;
              taskId = event.task_id;
              conversationId = event.conversation_id;
            }
          }
          // Chat identity can arrive before the chatflow's workflow identity.
          // Persist later enrichment so a restart can reconcile the workflow.
          if (
            messageId &&
            taskId &&
            conversationId &&
            (persistedWorkflowRunId !== workflowRunId || !identityPersisted)
          ) {
            await emit({
              type: "identity",
              runId: messageId,
              taskId,
              providerConversationId: conversationId,
              ...(workflowRunId ? { workflowRunId } : {}),
            });
            identityPersisted = true;
            persistedWorkflowRunId = workflowRunId;
          }
          if (event.event === "agent_message") {
            agentChunks = true;
            text += event.answer ?? "";
          }
          if (event.event === "message")
            text = agentChunks
              ? (event.answer ?? text)
              : text + (event.answer ?? "");
          if (event.event === "message_replace") text = event.answer ?? "";
          if (Buffer.byteLength(text) > 100_000)
            throw new Error("Chat output limit.");
          if (event.event === "message_end") {
            if (!messageId || !conversationId)
              throw new Error("Missing chat identity.");
            const execution: ProviderExecution = {
              runId: messageId,
              workflowId: null,
              status: "succeeded",
              outputs: { text },
              usage: parseUsage(event.metadata?.usage, "message", messageId),
            };
            if (workflowRunId) {
              messageResult = execution;
              await emit({ type: "usage", usage: execution.usage });
            } else {
              await emit({ type: "execution", execution });
              return { kind: "ok", value: execution };
            }
          }
          if (event.event === "workflow_finished") {
            if (!messageResult)
              return { kind: "unknown", failure: "invalid-response" };
            const finished = z
              .object({
                status: z.enum([
                  "succeeded",
                  "failed",
                  "stopped",
                  "partial-succeeded",
                ]),
                workflow_id: id,
              })
              .parse(event.data);
            if (
              binding.workflowId &&
              binding.workflowId !== finished.workflow_id
            )
              throw new Error("Workflow publication changed.");
            const execution = {
              ...messageResult,
              workflowId: finished.workflow_id,
              status: finished.status,
            };
            await emit({ type: "execution", execution });
            return { kind: "ok", value: execution };
          }
        }
        return { kind: "unknown", failure: "transport" };
      } catch (error) {
        if (persistenceFailed) throw error;
        return {
          kind: "unknown",
          failure:
            failure(error) === "timeout" ? "timeout" : "invalid-response",
        };
      }
    },
    async retrieve(messageId, signal) {
      id.parse(messageId);
      if (!conversationId)
        return { kind: "unknown", failure: "invalid-response" };
      signal = AbortSignal.any([
        AbortSignal.timeout(30_000),
        ...(signal ? [signal] : []),
      ]);
      let firstId: string | undefined;
      // Bounded history reads. Missing/unfinished messages remain unresolved;
      // never repeat a paid message to recover a dropped connection.
      for (let page = 0; page < 10; page++) {
        let response: Response;
        try {
          const query = new URLSearchParams({
            user: context.user,
            conversation_id: conversationId,
            limit: "100",
            ...(firstId ? { first_id: firstId } : {}),
          });
          response = await request(`/messages?${query}`, undefined, signal);
        } catch (error) {
          return { kind: "unknown", failure: failure(error) };
        }
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          return httpFailure(response, false);
        }
        try {
          const history = z
            .object({
              has_more: z.boolean(),
              data: z.array(
                z.object({
                  id,
                  conversation_id: id.optional(),
                  answer: z.string().max(100_000),
                  status: z.string().optional(),
                  message_tokens: z.unknown().optional(),
                  answer_tokens: z.unknown().optional(),
                  total_tokens: z.unknown().optional(),
                  total_price: z.unknown().optional(),
                  currency: z.unknown().optional(),
                }),
              ),
            })
            .parse(await readJson(response));
          const found = history.data.find((item) => item.id === messageId);
          if (found) {
            if (
              found.conversation_id &&
              found.conversation_id !== conversationId
            )
              throw new Error("Conversation changed.");
            // Saved chat history has no reliable completion flag across Dify
            // versions. Preserve the answer as evidence, but require explicit
            // reconciliation instead of charging for a possibly partial reply.
            const evidence: ProviderExecution = {
              runId: messageId,
              workflowId: null,
              status: found.status === "error" ? "failed" : "running",
              outputs: { text: found.answer },
              usage: parseUsage(
                {
                  prompt_tokens: found.message_tokens,
                  completion_tokens: found.answer_tokens,
                  total_tokens: found.total_tokens,
                  total_price: found.total_price,
                  currency: found.currency,
                },
                "message",
                messageId,
              ),
            };
            if (workflowRunId) {
              const statusResponse = await request(
                `/workflows/run/${workflowRunId}`,
                undefined,
                signal,
              );
              if (!statusResponse.ok) {
                await statusResponse.body?.cancel().catch(() => undefined);
                return { kind: "unknown", failure: "unavailable", evidence };
              }
              const state = z
                .object({
                  id,
                  workflow_id: id,
                  status: z.enum([
                    "running",
                    "paused",
                    "succeeded",
                    "failed",
                    "stopped",
                    "partial-succeeded",
                  ]),
                })
                .parse(await readJson(statusResponse));
              if (
                state.id !== workflowRunId ||
                (binding.workflowId && binding.workflowId !== state.workflow_id)
              )
                throw new Error("Workflow identity changed.");
              return {
                kind: "ok",
                value: {
                  ...evidence,
                  workflowId: state.workflow_id,
                  status: state.status,
                },
              };
            }
            return found.status === "error"
              ? { kind: "ok", value: evidence }
              : { kind: "unknown", failure: "unavailable", evidence };
          }
          if (!history.has_more || !history.data.length) break;
          const next = history.data[0].id;
          if (firstId === next) break;
          firstId = next;
        } catch {
          return { kind: "unknown", failure: "invalid-response" };
        }
      }
      return { kind: "unknown", failure: "unavailable" };
    },
    async stop(taskId, user, signal) {
      id.parse(taskId);
      if (user !== context.user) throw new Error("Chat user changed.");
      let response: Response;
      try {
        response = await request(
          `/chat-messages/${taskId}/stop`,
          { user },
          signal,
        );
      } catch (error) {
        return { kind: "unknown", failure: failure(error) };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return httpFailure(response, true);
      }
      try {
        z.object({ result: z.literal("success") }).parse(
          await readJson(response),
        );
        return { kind: "ok", value: undefined };
      } catch {
        return { kind: "unknown", failure: "invalid-response" };
      }
    },
  };
}
