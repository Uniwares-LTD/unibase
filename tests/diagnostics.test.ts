import assert from "node:assert/strict";
import { test } from "node:test";
import { safeRecord } from "../src/lib/diagnostics";
import { diagnostics } from "../src/lib/client/diagnostics";

test("diagnostics discard secret-bearing fields and untrusted identifiers", () => {
  const input = {
    status: 401,
    durationMs: 3.9,
    requestId: "secret-token",
    password: "hunter2",
    cookie: "session",
    url: "https://x/?token=secret",
    message: "private@example.com",
    stack: "secret",
  };
  const result = safeRecord("request", input);
  assert.deepEqual(Object.keys(result).sort(), [
    "durationMs",
    "event",
    "status",
    "timestamp",
  ]);
  assert.equal(result.durationMs, 4);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(
    safeRecord("request", { durationMs: NaN, status: Infinity }).status,
    undefined,
  );
});
test("diagnostics are opt-in, bounded, cleared on disable, and never enabled by errors", () => {
  diagnostics.setEnabled(false);
  diagnostics.record("browser-error");
  assert.equal(diagnostics.entries().length, 0);
  diagnostics.setEnabled(true);
  for (let index = 0; index < 150; index++)
    diagnostics.record("request", { status: 200, durationMs: index });
  assert.equal(diagnostics.entries().length, 100);
  assert.equal(diagnostics.entries()[0].durationMs, 50);
  assert.equal(JSON.parse(diagnostics.export()).length, 100);
  diagnostics.setEnabled(false);
  diagnostics.record("unhandled-rejection");
  assert.equal(diagnostics.isEnabled(), false);
  assert.equal(diagnostics.export(), "[]");
});
