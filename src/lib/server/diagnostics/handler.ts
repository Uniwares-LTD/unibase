import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { UserRecord } from "firebase-admin/auth";
import { AppError } from "../../auth-policy";
import { readText } from "../../upload-body";
import type { DiagnosticsConfig } from "../../config/diagnostics";
import { diagnosticRequestSchema } from "../../contracts/diagnostics";
import {
  authenticateOperator,
  DiagnosticRateError,
  type IdentityUser,
} from "./authenticate";
import { readCursor, signCursor } from "./cursor";
import type {
  AccessTarget,
  CapabilityDefinition,
  DiagnosticContext,
} from "./context";
import type { GrantStore } from "./grant-store";
import { writeAccessRecord } from "./access-log";

export const REQUEST_LIMIT = 16 * 1024;
export const RESPONSE_LIMIT = 512 * 1024;
export const DEADLINE_MS = 10_000;
// Part of the overall deadline kept back so the access record can be written.
const AUDIT_RESERVE_MS = 1500;

export type DiagnosticsDependencies = {
  config: DiagnosticsConfig;
  db: () => Db;
  /** Throws when required grant-storage or request-protection dependencies are unavailable. */
  store: () => Promise<GrantStore>;
  identity: {
    getUser(uid: string): Promise<UserRecord | null>;
    getUserByEmail(email: string): Promise<UserRecord | null>;
  };
  redisPing: () => Promise<void>;
  registry: Record<string, CapabilityDefinition>;
  now?: () => number;
  deadlineMs?: number;
  log?: (status: number, requestId: string, started: number) => void;
};

const fail = (code: string, message: string, status: number) =>
  new AppError(code, message, status);

/** Transport-independent POST handler; returns a complete Response. */
export async function handleDiagnostics(
  request: Request,
  deps: DiagnosticsDependencies,
): Promise<Response> {
  const started = performance.now();
  const requestId = randomUUID();
  const now = deps.now ?? Date.now;
  // Absolute deadline for the whole request: authentication, body, work, audit.
  const deadline = now() + (deps.deadlineMs ?? DEADLINE_MS);
  const remaining = (reserve: number) => deadline - reserve - now();
  const timedOut = () =>
    fail("DIAGNOSTICS_TIMEOUT", "The request took too long.", 504);
  const withinDeadline = <T>(
    promise: Promise<T>,
    reserve = AUDIT_RESERVE_MS,
  ): Promise<T> => {
    const left = remaining(reserve);
    if (left <= 0) {
      promise.catch(() => undefined);
      return Promise.reject(timedOut());
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timedOut()), left);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const respond = (
    status: number,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    try {
      deps.log?.(status, requestId, started);
    } catch {
      /* Advisory only. */
    }
    return new Response(JSON.stringify({ requestId, ...body }), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-ID": requestId,
        ...headers,
      },
    });
  };
  const error = (failure: AppError) =>
    respond(
      failure.status,
      { error: { code: failure.code, message: failure.message } },
      {
        ...(failure instanceof DiagnosticRateError
          ? { "Retry-After": String(failure.retryAfter) }
          : {}),
        ...(failure.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="diagnostics"' }
          : {}),
        ...(failure.status === 405 ? { Allow: "POST" } : {}),
      },
    );
  if (!deps.config.enabled) return error(fail("NOT_FOUND", "Not found.", 404));
  if (request.method !== "POST")
    return error(fail("METHOD_NOT_ALLOWED", "Use POST.", 405));
  if (!deps.config.redisUrl)
    return error(
      fail(
        "DIAGNOSTICS_REDIS_UNAVAILABLE",
        "Diagnostics requires Redis. Configure REDIS_URL.",
        503,
      ),
    );

  let db: Db;
  let operator;
  try {
    db = deps.db();
    const database = db;
    operator = await withinDeadline(
      (async () => {
        const store = await deps.store().catch(() => {
          throw fail(
            "DIAGNOSTICS_REDIS_UNAVAILABLE",
            "Diagnostic access storage is unavailable.",
            503,
          );
        });
        return authenticateOperator(request.headers.get("authorization"), {
          db: database,
          store,
          now,
          getUser: async (uid): Promise<IdentityUser | null> =>
            deps.identity.getUser(uid),
        });
      })(),
    );
  } catch (failure) {
    return error(
      failure instanceof AppError
        ? failure
        : fail("DIAGNOSTICS_UNAVAILABLE", "Diagnostics is unavailable.", 503),
    );
  }

  const targets: AccessTarget[] = [];
  let capability = "unknown";
  const record = (outcome: "returned" | "failed", status: number) =>
    withinDeadline(
      writeAccessRecord(
        db,
        {
          _id: requestId,
          timestamp: new Date(now()),
          requestId,
          operatorUid: operator.uid,
          grantId: operator.grantId,
          capability,
          outcome,
          status,
          targets: targets.slice(0, 20),
        },
        Math.max(1, remaining(0)),
      ),
      0,
    );
  const failed = async (failure: AppError) => {
    // Failures return no data; their record is best-effort evidence.
    await record("failed", failure.status).catch(() => undefined);
    return error(failure);
  };

  let input: unknown;
  let definition: CapabilityDefinition;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw fail("INVALID_INPUT", "Send a JSON request.", 415);
    let raw: unknown;
    try {
      raw = JSON.parse(await withinDeadline(readText(request, REQUEST_LIMIT)));
    } catch (failure) {
      if (failure instanceof AppError) throw failure;
      throw fail("INVALID_INPUT", "Request is not valid JSON.", 400);
    }
    const parsed = diagnosticRequestSchema.safeParse(raw);
    if (!parsed.success)
      throw fail("INVALID_INPUT", "Send exactly { capability, payload }.", 400);
    capability = parsed.data.capability;
    if (!Object.hasOwn(deps.registry, capability))
      throw fail("UNKNOWN_CAPABILITY", "Unknown capability.", 400);
    if (!operator.capabilities.has(capability))
      throw fail(
        "CAPABILITY_NOT_GRANTED",
        "This grant does not permit that capability.",
        403,
      );
    definition = deps.registry[capability];
    const payload = definition.input.safeParse(parsed.data.payload);
    if (!payload.success)
      throw fail(
        "INVALID_INPUT",
        "Check the payload against capabilities.list.",
        400,
      );
    input = payload.data;
  } catch (failure) {
    return failed(
      failure instanceof AppError
        ? failure
        : fail("INVALID_INPUT", "Invalid request.", 400),
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, remaining(AUDIT_RESERVE_MS)),
  );
  const cursorScope = (criteria: unknown) => ({
    key: operator.cursorKey,
    grantId: operator.grantId,
    capability,
    criteria,
    grantExpiresAt: operator.expiresAt,
    now: now(),
  });
  const context: DiagnosticContext = {
    db,
    operator,
    capability,
    signal: controller.signal,
    now: new Date(now()),
    timeoutMS: () => Math.max(1, remaining(AUDIT_RESERVE_MS)),
    target: (target) => {
      if (targets.length < 20) targets.push(target);
    },
    readCursor: (criteria, cursor) => readCursor(cursorScope(criteria), cursor),
    signCursor: (criteria, value, id) =>
      signCursor(cursorScope(criteria), value, id),
    identity: deps.identity,
    redisPing: deps.redisPing,
  };
  let body: string;
  try {
    const timeout = new Promise<never>((_, reject) =>
      controller.signal.addEventListener("abort", () => reject(timedOut())),
    );
    const data = await Promise.race([definition.run(context, input), timeout]);
    body = JSON.stringify({ requestId, capability, data });
  } catch (failure) {
    clearTimeout(timer);
    controller.abort();
    const timedOut =
      failure instanceof Error && failure.name === "MongoOperationTimeoutError";
    return failed(
      failure instanceof AppError
        ? failure
        : timedOut
          ? fail("DIAGNOSTICS_TIMEOUT", "The request took too long.", 504)
          : fail(
              "DIAGNOSTICS_UNAVAILABLE",
              "A diagnostic dependency is unavailable.",
              503,
            ),
    );
  }
  clearTimeout(timer);
  if (Buffer.byteLength(body) > RESPONSE_LIMIT)
    return failed(
      fail(
        "DIAGNOSTICS_RESPONSE_TOO_LARGE",
        "The result exceeds the response limit. Narrow the criteria.",
        422,
      ),
    );
  // The access record must exist before any diagnostic data is returned.
  try {
    await record("returned", 200);
  } catch {
    return error(
      fail(
        "DIAGNOSTICS_AUDIT_UNAVAILABLE",
        "Diagnostic access could not be recorded; no data was returned.",
        503,
      ),
    );
  }
  try {
    deps.log?.(200, requestId, started);
  } catch {
    /* Advisory only. */
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-ID": requestId,
    },
  });
}
