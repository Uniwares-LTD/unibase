import "server-only";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type ProviderStatus =
  | "running"
  | "paused"
  | "succeeded"
  | "partial-succeeded"
  | "failed"
  | "stopped";
export type ProviderFailure =
  | "authentication"
  | "invalid-request"
  | "rate-limit"
  | "unavailable"
  | "invalid-response"
  | "timeout"
  | "transport";
export type UsageObservation = {
  // Never sum execution summaries with the individual nodes they summarize.
  scope: "execution" | "node" | "message";
  id: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cost: { amount: string; currency: string; source: "provider" } | null;
  elapsedMs: number | null;
};
export type ProviderExecution = {
  runId: string;
  workflowId: string | null;
  status: ProviderStatus;
  outputs: Record<string, Json> | null;
  usage: UsageObservation;
};
export type ProviderEvent =
  | {
      type: "identity";
      runId: string;
      taskId: string;
      providerConversationId?: string;
      workflowRunId?: string;
    }
  | { type: "execution"; execution: ProviderExecution }
  | { type: "usage"; usage: UsageObservation };
export type ProviderOutcome<T> =
  | { kind: "ok"; value: T }
  | {
      kind: "rejected" | "unknown";
      failure: ProviderFailure;
      retryAfterMs?: number;
      evidence?: T;
    };
export type WorkflowInput = {
  user: string;
  inputs: Record<string, Json>;
};
export interface WorkflowProvider {
  start(
    input: WorkflowInput,
    observe: (event: ProviderEvent) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome<ProviderExecution>>;
  retrieve(
    runId: string,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome<ProviderExecution>>;
  stop(
    taskId: string,
    user: string,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome<void>>;
}
