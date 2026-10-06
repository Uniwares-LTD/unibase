import assert from "node:assert/strict";
import { test } from "node:test";
import { probeReadiness } from "../src/lib/readiness";

test("readiness requires every dependency and suppresses private failures", async () => {
  assert.equal(await probeReadiness([async () => 1, async () => 2]), true);
  assert.equal(
    await probeReadiness([
      async () => {
        throw new Error("secret URI");
      },
    ]),
    false,
  );
});

test("one deadline bounds an unresponsive dependency and cancels work", async () => {
  let signal: AbortSignal | undefined;
  const start = Date.now();
  assert.equal(
    await probeReadiness(
      [
        (s) => {
          signal = s;
          return new Promise(() => {});
        },
      ],
      25,
    ),
    false,
  );
  assert.equal(signal?.aborted, true);
  assert.ok(Date.now() - start < 500);
});
