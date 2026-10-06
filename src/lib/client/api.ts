import { z } from "zod";
import { csrfSchema, errorSchema } from "../contracts/profile";
import { diagnostics } from "./diagnostics";

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
    method?: "GET" | "POST" | "PATCH" | "DELETE";
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
  if (options.body !== undefined && !multipart)
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
          body: multipart
            ? (options.body as FormData)
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
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server returned an unexpected response.",
    );
  }
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    if (error.success)
      throw new ApiError(
        error.data.error.code,
        error.data.error.message,
        error.data.error.requestId,
      );
    throw new ApiError("REQUEST_FAILED", "The request could not be completed.");
  }
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server returned an unexpected response.",
    );
  return result.data;
}
