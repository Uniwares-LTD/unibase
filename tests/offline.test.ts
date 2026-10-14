import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
test("worker caches only public fallback and never stores or substitutes API/auth responses", async () => {
  const handlers: Record<
    string,
    (event: {
      request?: { url: string; mode: string; method: string };
      waitUntil?: (promise: Promise<unknown>) => void;
      respondWith?: (promise: Promise<Response>) => void;
    }) => void
  > = {};
  const added: string[] = [];
  const deleted: string[] = [];
  let offline = false;
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: {
      location: {
        origin: "https://unibase.test",
        href: "https://unibase.test/sw.js?namespace=unibase",
      },
      clients: { claim: async () => {} },
      addEventListener: (
        type: string,
        handler: (event: {
          request?: { url: string; mode: string; method: string };
          waitUntil?: (promise: Promise<unknown>) => void;
          respondWith?: (promise: Promise<Response>) => void;
        }) => void,
      ) => {
        handlers[type] = handler;
      },
    },
    URL,
    Response,
    caches: {
      open: async () => ({
        add: async (request: Request) => {
          added.push(request.url);
        },
      }),
      keys: async () => [
        "unibase-offline-old",
        "unibase-offline-v2",
        "another-app",
      ],
      delete: async (key: string) => {
        deleted.push(key);
      },
      match: async () => new Response("public offline fallback"),
    },
    // Worker-relative URLs are legal in browsers; adapt Node's Request base.
    Request: class extends Request {
      constructor(url: string, init: RequestInit) {
        super(new URL(url, "https://unibase.test"), init);
      }
    },
    fetch: async () => {
      if (offline) throw new TypeError("offline");
      return new Response("private account");
    },
  });
  let pending: Promise<unknown> | undefined;
  handlers.install({
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(added, [
    "https://unibase.test/offline.html",
    "https://unibase.test/offline-locale.js",
  ]);
  handlers.activate({
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(deleted, ["unibase-offline-old"]);
  const navigate = async (path: string, mode = "navigate", method = "GET") => {
    let response: Promise<Response> | undefined;
    handlers.fetch({
      request: { url: `https://unibase.test${path}`, mode, method },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    return response ? (await response).text() : null;
  };
  assert.equal(await navigate("/account"), "private account");
  offline = true;
  assert.equal(await navigate("/account"), "public offline fallback");
  assert.equal(await navigate("/api/profile"), null);
  assert.equal(await navigate("/__/auth/handler?code=secret"), null);
  assert.equal(await navigate("/account?_rsc=123", "cors"), null);
  assert.equal(await navigate("/account", "navigate", "POST"), null);
  assert.equal(added.length, 2);
});
