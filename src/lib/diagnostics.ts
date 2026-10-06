// An allowlist, rather than free-text redaction: URLs, errors, headers and bodies
// must never become diagnostic payloads, even when they contain unfamiliar secrets.
export const events = [
  "request",
  "profile-save",
  "admin-access-change",
  "admin-profile-edit",
  "credit-adjustment",
  "purchase-simulation-start",
  "purchase-simulation-event",
  "stripe-checkout",
  "payment-maintenance",
  "ai-maintenance",
  "server-error",
  "browser-error",
  "unhandled-rejection",
  "route-error",
  "global-error",
  "offline",
  "online",
  "worker-ready",
  "worker-failed",
  "diagnostics-enabled",
] as const;
export type DiagnosticEvent = (typeof events)[number];
export function safeRecord(
  event: DiagnosticEvent,
  input: { status?: number; durationMs?: number; requestId?: string } = {},
) {
  return {
    timestamp: new Date().toISOString(),
    event: events.includes(event) ? event : "server-error",
    ...(Number.isInteger(input.status) &&
    input.status! >= 100 &&
    input.status! <= 599
      ? { status: input.status }
      : {}),
    ...(Number.isFinite(input.durationMs) && input.durationMs! >= 0
      ? { durationMs: Math.round(input.durationMs!) }
      : {}),
    ...(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.requestId ?? "",
    )
      ? { requestId: input.requestId }
      : {}),
  };
}
