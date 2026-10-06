import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, requireSameOrigin } from "../auth-policy";
import { getConfig } from "./config";
import { unstable_rethrow } from "next/navigation";
import { logOperation } from "./log";

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: getConfig().server.origin.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
  };
}
export function cookieName(kind: "session" | "csrf") {
  return `${cookieOptions().secure ? "__Host-" : ""}unitale-${kind}`;
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function endpoint(action: () => Promise<Response>) {
  const requestId = randomUUID();
  const started = performance.now();
  try {
    const response = await action();
    response.headers.set("X-Request-ID", requestId);
    logOperation("request", started, response.status, requestId);
    return response;
  } catch (error) {
    unstable_rethrow(error);
    const safe =
      error instanceof AppError
        ? error
        : new AppError(
            "SERVICE_UNAVAILABLE",
            "We couldn’t complete that request. Please try again.",
            503,
          );
    const response = json(
      { error: { code: safe.code, message: safe.message, requestId } },
      safe.status,
    );
    response.headers.set("X-Request-ID", requestId);
    logOperation("request", started, response.status, requestId);
    return response;
  }
}
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 20000,
): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("INVALID_INPUT", "Send a JSON request.", 415);
  const text = await readText(request, limit);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError("INVALID_INPUT", "Request is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new AppError(
      "INVALID_INPUT",
      "Check the submitted fields and try again.",
    );
  return parsed.data;
}
export async function readText(request: Request, limit = 20000) {
  // Bound even chunked requests rather than trusting Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Request body is required.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new AppError("INVALID_INPUT", "Request is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function checkMutation(request: Request) {
  requireSameOrigin(request.headers, getConfig().server.origin);
  const supplied = request.headers.get("x-csrf-token") ?? "";
  const expected = (await cookies()).get(cookieName("csrf"))?.value ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !/^[a-f0-9]{64}$/.test(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw new AppError(
      "INVALID_CSRF",
      "Please refresh the page and try again.",
      403,
    );
  }
}
export async function issueCsrf() {
  const jar = await cookies();
  const existing = jar.get(cookieName("csrf"))?.value;
  const token =
    existing && /^[a-f0-9]{64}$/.test(existing)
      ? existing
      : randomBytes(32).toString("hex");
  jar.set(cookieName("csrf"), token, { ...cookieOptions(), maxAge: 3600 });
  return token;
}
