import assert from "node:assert/strict";
import { test } from "node:test";
import { difyJson } from "../../src/lib/server/runs/dify-console-client";

test("Dify Console fixtures isolate management authentication and bound mutation outcomes", async () => {
  const originalFetch = globalThis.fetch;
  const names = [
    "DIFY_CONSOLE_URL",
    "DIFY_MANAGEMENT_KEY",
    "DIFY_WORKSPACE_ID",
    "DIFY_BASE_URL",
  ] as const;
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.DIFY_CONSOLE_URL = "https://dify.example.test/console/api";
  process.env.DIFY_BASE_URL = "https://dify.example.test/v1";
  process.env.DIFY_MANAGEMENT_KEY = "management-fixture";
  process.env.DIFY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
  try {
    const requests: { url: string; options: RequestInit }[] = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options: options! });
      const fixture = String(url).includes("export")
        ? { data: "sanitized DSL" }
        : String(url).endsWith("confirm")
          ? { status: "completed", app_id: "fixture" }
          : {
              status: "pending",
              id: "import-fixture",
              warnings: [{ type: "dependency" }],
            };
      return Response.json(fixture, { status: 202 });
    };
    assert.deepEqual(
      await difyJson("/apps/imports", {
        management: true,
        body: { mode: "yaml-content", yaml_content: "fixture" },
      }),
      {
        status: "pending",
        id: "import-fixture",
        warnings: [{ type: "dependency" }],
      },
    );
    await difyJson("/apps/imports/fixture/confirm", {
      management: true,
      body: {},
    });
    assert.deepEqual(
      await difyJson("/apps/fixture/export?include_secret=false", {
        management: true,
      }),
      { data: "sanitized DSL" },
    );
    assert.equal(
      new Headers(requests[0].options.headers).get("Authorization"),
      "Bearer management-fixture",
    );
    assert.equal(
      new Headers(requests[0].options.headers).get("X-WORKSPACE-ID"),
      process.env.DIFY_WORKSPACE_ID,
    );
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(requests[0].options.cache, "no-store");
    await difyJson("/parameters", { key: "execution-fixture" });
    assert.equal(
      new Headers(requests.at(-1)!.options.headers).get("Authorization"),
      "Bearer execution-fixture",
    );
    assert.equal(
      new Headers(requests.at(-1)!.options.headers).has("X-WORKSPACE-ID"),
      false,
    );
    globalThis.fetch = async () =>
      Response.json({ status: "failed", error: "dependency" }, { status: 400 });
    assert.equal(
      (
        (await difyJson("/apps/imports", { management: true, body: {} })) as {
          status: string;
        }
      ).status,
      "failed",
    );
    globalThis.fetch = async () =>
      new Response("private-denied", { status: 403 });
    await assert.rejects(
      difyJson("/apps", { management: true }),
      (e) => e instanceof Error && !e.message.includes("private-denied"),
    );
    globalThis.fetch = async () => {
      throw new Error("private-transport");
    };
    await assert.rejects(
      difyJson("/apps/imports", { management: true, body: {} }),
      /did not confirm/,
    );
    globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1));
    await assert.rejects(
      difyJson("/apps", { management: true }),
      /exceeds the limit/,
    );
    delete process.env.DIFY_MANAGEMENT_KEY;
    await assert.rejects(
      difyJson("/apps", { management: true }),
      /management is disabled/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names)
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
  }
});
