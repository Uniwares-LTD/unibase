import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { api, ApiError } from "../src/lib/client/api";

Object.defineProperty(globalThis, "location", {
  value: { origin: "https://unitale.example" },
  configurable: true,
});

test("API client preserves multipart file bodies and lets fetch set their boundary", async (context) => {
  const form = new FormData();
  form.set(
    "file",
    new File(["fixture"], "fixture.txt", { type: "text/plain" }),
  );
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, options: RequestInit) => {
      if (path.endsWith("/csrf"))
        return Response.json({ token: "a".repeat(64) });
      assert.equal(options.body, form);
      assert.equal(new Headers(options.headers).get("content-type"), null);
      assert.equal(
        new Headers(options.headers).get("x-csrf-token"),
        "a".repeat(64),
      );
      return Response.json({ uploaded: true });
    },
  );
  assert.deepEqual(
    await api("/api/ai/files", z.object({ uploaded: z.boolean() }), {
      method: "POST",
      body: form,
      timeoutMs: 120000,
    }),
    { uploaded: true },
  );
});
test("API client obtains CSRF and never retries a failed mutation", async (context) => {
  const calls: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (path: string, options: RequestInit) => {
      calls.push(path);
      if (path.endsWith("/csrf"))
        return Response.json({ token: "a".repeat(64) });
      assert.equal(
        (options.headers as Record<string, string>)["x-csrf-token"],
        "a".repeat(64),
      );
      assert.equal(options.credentials, "same-origin");
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "Check your input.",
            requestId: "request-1",
          },
        },
        { status: 400 },
      );
    },
  );
  await assert.rejects(
    api("/api/profile", z.object({ ok: z.boolean() }), {
      method: "PATCH",
      body: {},
    }),
    (error) =>
      error instanceof ApiError &&
      error.code === "INVALID_INPUT" &&
      error.requestId === "request-1",
  );
  assert.deepEqual(calls, ["/api/auth/csrf", "/api/profile"]);
});
test("API client rejects invalid successful responses and foreign destinations", async (context) => {
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ unexpected: true }),
  );
  await assert.rejects(
    api("/api/profile", z.object({ uid: z.string() })),
    (error) => error instanceof ApiError && error.code === "INVALID_RESPONSE",
  );
  await assert.rejects(
    api("https://attacker.example/api/profile", z.unknown()),
    /same-origin/,
  );
});
test("API client passes caller cancellation to the request", async (context) => {
  const controller = new AbortController();
  controller.abort();
  context.mock.method(
    globalThis,
    "fetch",
    async (_path: string, options: RequestInit) => {
      assert.equal(options.signal?.aborted, true);
      throw options.signal?.reason;
    },
  );
  await assert.rejects(
    api("/api/profile", z.unknown(), { signal: controller.signal }),
    { name: "AbortError" },
  );
});
