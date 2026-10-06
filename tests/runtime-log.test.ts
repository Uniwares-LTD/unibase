import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { runtimeRecord } from "../src/lib/log-policy";
import { RuntimeWriter } from "../src/lib/runtime-writer";

test("runtime logs allowlist fields and derive severity without raw payloads", () => {
  const id = randomUUID();
  const record = runtimeRecord("credit-adjustment", {
    status: 403,
    durationMs: 12.6,
    requestId: id,
    severity: "info",
    message: "secret-password",
    stack: "secret-stack",
    cookie: "secret-cookie",
    token: "secret-token",
    query: "secret-query",
    body: { private: "secret-body" },
  });
  assert.equal(record.severity, "warn");
  assert.equal(record.durationMs, 13);
  assert.equal(record.requestId, id);
  assert.equal(JSON.stringify(record).includes("secret"), false);
  assert.deepEqual(Object.keys(record).sort(), [
    "durationMs",
    "event",
    "requestId",
    "severity",
    "status",
    "timestamp",
  ]);
  assert.equal(
    runtimeRecord("server-error", { status: 500 }).severity,
    "error",
  );
  assert.equal(runtimeRecord("request", { status: 200 }).severity, "info");
  assert.equal(
    "requestId" in runtimeRecord("request", { requestId: "attacker-value" }),
    false,
  );
});
test("runtime delivery is bounded, drops excess and tolerates failed writes", async () => {
  const finishes: (() => void)[] = [];
  let failed = 0;
  const writer = new RuntimeWriter<number>(
    () => new Promise<void>((resolve) => finishes.push(resolve)),
    () => {
      failed++;
    },
    { concurrency: 1, queued: 2, timeoutMS: 500 },
  );
  const one = writer.enqueue(1);
  const two = writer.enqueue(2);
  const three = writer.enqueue(3);
  assert.equal(await writer.enqueue(4), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writer.stats(), {
    active: 1,
    queued: 2,
    dropped: 1,
    failed: 0,
  });
  finishes.shift()!();
  assert.equal(await one, true);
  await new Promise((resolve) => setImmediate(resolve));
  finishes.shift()!();
  assert.equal(await two, true);
  await new Promise((resolve) => setImmediate(resolve));
  finishes.shift()!();
  assert.equal(await three, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writer.stats().active, 0);
  assert.equal(failed, 0);
  const broken = new RuntimeWriter<number>(
    async () => {
      throw new Error("secret-provider-failure");
    },
    () => {
      failed++;
    },
  );
  assert.equal(await broken.enqueue(1), false);
  assert.equal(failed, 1);
});
test("runtime deadline aborts cooperative writes without failing the caller", async () => {
  const writer = new RuntimeWriter<number>(
    (_record, signal) =>
      new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Deadline")), {
          once: true,
        }),
      ),
    () => {},
    { concurrency: 1, queued: 1, timeoutMS: 20 },
  );
  // The production deadline is unref'd; a test-only referenced timer keeps the
  // test process alive while the cooperative writer observes the abort signal.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    assert.equal(await writer.enqueue(1), false);
  } finally {
    clearTimeout(keepAlive);
  }
});
