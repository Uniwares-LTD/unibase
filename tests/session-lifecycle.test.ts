import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { api } from "../src/lib/client/api";
import { invalidateBrowserSession } from "../src/lib/client/session-lifecycle";
test("session invalidation aborts in-flight reads and discards late private responses", async (context) => {
  Object.defineProperty(globalThis, "location", {
    value: { origin: "https://example.test" },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true,
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.mock.method(globalThis, "fetch", async () => {
    await pending;
    return Response.json({ private: "old-account" });
  });
  const request = api("/api/runs", z.object({ private: z.string() }));
  invalidateBrowserSession();
  release();
  await assert.rejects(request, { name: "AbortError" });
});
