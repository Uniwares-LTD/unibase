import assert from "node:assert/strict";
import { test } from "node:test";
import en from "../messages/en.json";
import ar from "../messages/ar.json";
import { runStatuses } from "../src/lib/contracts/runs";
import { privateFileSchema } from "../src/lib/contracts/files";

test("every displayed run and file status has a label in each locale", () => {
  const fileStates = privateFileSchema.shape.state.options;
  for (const states of [en.states, ar.states] as Record<string, string>[])
    for (const status of [...runStatuses, ...fileStates, "applying", "applied"])
      assert.ok(states[status], status);
});
