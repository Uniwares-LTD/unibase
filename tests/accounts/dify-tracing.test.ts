import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { tracingForRun } from "../../src/lib/server/runs/provider";
import type { AiJob } from "../../src/lib/server/ai/jobs";

test("terminal tracing reads only the accepted app/Run and discards provider inputs and outputs", async () => {
  const previous = process.env.DIFY_MANAGEMENT_KEY;
  process.env.DIFY_MANAGEMENT_KEY = "fixture-management";
  try {
    const appId = randomUUID(),
      runId = randomUUID();
    const job = {
      binding: { mode: "live" },
      runId,
      run: { orchestrator: { appId } },
    } as AiJob;
    const result = await tracingForRun(job, async (path, options) => {
      assert.equal(
        path,
        `/apps/${appId}/workflow-runs/${runId}/node-executions`,
      );
      assert.equal(options?.management, true);
      assert.equal(options?.body, undefined);
      return {
        data: [
          {
            id: "node-execution",
            node_id: "compose",
            title: "Compose result",
            status: "succeeded",
            elapsed_time: 0.1,
            inputs: { credential: "private-input" },
            outputs: { secret: "private-output" },
          },
        ],
      };
    });
    assert.deepEqual(result, [
      {
        type: "stage",
        id: "node-execution",
        nodeId: "compose",
        title: "Compose result",
        status: "succeeded",
        elapsedMs: 100,
      },
    ]);
    assert.ok(!JSON.stringify(result).includes("private"));
    let contacted = false;
    assert.deepEqual(
      await tracingForRun(
        { ...job, binding: { mode: "fake" } } as AiJob,
        async () => {
          contacted = true;
          return {};
        },
      ),
      [],
    );
    assert.equal(contacted, false);
  } finally {
    if (previous === undefined) delete process.env.DIFY_MANAGEMENT_KEY;
    else process.env.DIFY_MANAGEMENT_KEY = previous;
  }
});
