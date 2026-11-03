import { z } from "zod";
import { csrfSchema, errorSchema } from "../contracts/profile";
import { diagnostics } from "./diagnostics";
import {
  sessionRequestSignal,
  announceSessionChange,
} from "./session-lifecycle";

const unavailable = () =>
  typeof document !== "undefined" && document.documentElement.lang === "ar"
    ? "تعذر إكمال الطلب. يرجى المحاولة مجدداً."
    : "The server returned an unexpected response.";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  if (
    !path.startsWith("/api/") ||
    path.includes("\\") ||
    new URL(path, location.origin).origin !== location.origin
  )
    throw new Error("API requests must remain same-origin.");
  const signal = AbortSignal.any([
    sessionRequestSignal(),
    AbortSignal.timeout(
      Math.min(120000, Math.max(1000, options.timeoutMs ?? 15000)),
    ),
    ...(options.signal ? [options.signal] : []),
  ]);
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    const csrf = await api("/api/auth/csrf", csrfSchema, { signal });
    headers["x-csrf-token"] = csrf.token;
  }
  const multipart = options.body instanceof FormData;
  // Blobs are sent as raw bytes, for example resumable upload parts.
  const raw = options.body instanceof Blob;
  if (raw) headers["content-type"] = "application/octet-stream";
  else if (options.body !== undefined && !multipart)
    headers["content-type"] = "application/json";
  const started = performance.now();
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    ...(options.body !== undefined
      ? {
          body:
            multipart || raw
              ? (options.body as FormData | Blob)
              : JSON.stringify(options.body),
        }
      : {}),
  }).catch((error: unknown) => {
    diagnostics.record("request", { durationMs: performance.now() - started });
    throw error;
  });
  diagnostics.record("request", {
    status: response.status,
    durationMs: performance.now() - started,
    requestId: response.headers.get("x-request-id") ?? undefined,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("INVALID_RESPONSE", unavailable());
  }
  signal.throwIfAborted();
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    if (error.success) {
      if (
        ["UNAUTHENTICATED", "ACCOUNT_CHANGED"].includes(error.data.error.code)
      )
        announceSessionChange();
      throw new ApiError(
        error.data.error.code,
        error.data.error.message,
        error.data.error.requestId,
      );
    }
    throw new ApiError("REQUEST_FAILED", unavailable());
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError("INVALID_RESPONSE", unavailable());
  return result.data;
}
