import { safeRecord, type DiagnosticEvent } from "./diagnostics";

export function runtimeRecord(event: DiagnosticEvent, input: unknown = {}) {
  const fields =
    input !== null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const safe = safeRecord(event, {
    status: typeof fields.status === "number" ? fields.status : undefined,
    durationMs:
      typeof fields.durationMs === "number" ? fields.durationMs : undefined,
    requestId:
      typeof fields.requestId === "string" ? fields.requestId : undefined,
  });
  return {
    ...safe,
    severity:
      safe.status !== undefined && safe.status >= 500
        ? ("error" as const)
        : safe.status !== undefined && safe.status >= 400
          ? ("warn" as const)
          : ("info" as const),
  };
}
export type RuntimeRecord = ReturnType<typeof runtimeRecord>;
