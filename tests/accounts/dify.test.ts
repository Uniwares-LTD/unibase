import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDifyConfig } from "../../src/lib/config/dify";
import {
  createDifyWorkflow,
  parseUsage,
  providerUser,
} from "../../src/lib/server/ai/dify";
import { readSse } from "../../src/lib/server/ai/sse";
import type { ProviderEvent } from "../../src/lib/server/ai/types";

const runId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const workflowId = "00000000-0000-4000-8000-000000000003";
const config = parseDifyConfig({
  DIFY_MODE: "live",
  DIFY_BASE_URL: "https://dify.example.test/v1",
  DIFY_ORCHESTRATORS_JSON: JSON.stringify([
    {
      id: "example",
      name: "Example",
      description: "",
      order: 0,
      enabled: true,
      keyEnv: "DIFY_KEY_EXAMPLE",
      workflowId,
      inputs: [],
      pricing: null,
      recovery: null,
    },
  ]),
  DIFY_KEY_EXAMPLE: "secret-canary",
});
if (config.mode !== "live") throw new Error("Invalid fixture.");
const live = config;
const input = { user: providerUser("owner"), inputs: { question: "hello" } };
const detail = {
  id: runId,
  workflow_id: workflowId,
  status: "succeeded",
  outputs: { answer: "Héllo 👋" },
  total_tokens: 12,
  elapsed_time: 1.5,
};

function streamed(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(index, index + chunkSize));
      index += chunkSize;
    },
  });
}
function sse(...events: unknown[]) {
  return new Response(
    streamed(
      `event: ping\r\n\r\n${events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("")}`,
    ),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const started = {
  event: "workflow_started",
  workflow_run_id: runId,
  task_id: taskId,
  data: {},
};

test("pinned Dify reconnect replays node snapshots and parent Human Input without dispatch", async () => {
  const observed: ProviderEvent[] = [];
  let calls = 0;
  const provider = createDifyWorkflow(
    live,
    live.bindings[0],
    async (url, options) => {
      calls++;
      if (String(url).includes("/events?")) {
        assert.equal(options?.method, "GET");
        assert.equal(options?.body, undefined);
        assert.ok(String(url).includes("include_state_snapshot=true"));
        return sse(
          started,
          {
            event: "node_started",
            workflow_run_id: runId,
            task_id: taskId,
            data: { id: "execution-1", node_id: "draft", title: "Draft" },
          },
          {
            event: "human_input_required",
            workflow_run_id: runId,
            task_id: taskId,
            data: {
              node_id: "decision",
              node_title: "Choose",
              form_token: "private-form-token",
            },
          },
          {
            event: "workflow_paused",
            workflow_run_id: runId,
            task_id: taskId,
            data: {},
          },
        );
      }
      assert.equal(url, `${live.baseUrl}/workflows/run/${runId}`);
      return Response.json({ ...detail, status: "paused" });
    },
  );
  const outcome = await provider.stream!(runId, input.user, async (e) => {
    observed.push(e);
  });
  assert.equal(outcome.kind, "ok");
  assert.equal(calls, 2);
  assert.deepEqual(
    observed.map((e) => e.type),
    ["stage", "decision"],
  );
});
test("Human Input submission uses the native action/response contract and matching user", async () => {
  const provider = createDifyWorkflow(
    live,
    live.bindings[0],
    async (url, options) => {
      assert.equal(url, `${live.baseUrl}/form/human_input/private-token`);
      assert.deepEqual(JSON.parse(String(options?.body)), {
        user: input.user,
        action: "continue",
        inputs: { response: '{"direction":"brief"}' },
      });
      return Response.json({});
    },
  );
  await provider.submit!("private-token", input.user, "continue", {
    response: '{"direction":"brief"}',
  });
});

test("SSE handles split unicode, CRLF, multiline data, ping and incomplete frames", async () => {
  const values = [];
  for await (const value of readSse(
    streamed(
      'event: ping\r\n\r\ndata: {"text":\r\ndata: "Héllo 👋"}\r\n\r\ndata: {"incomplete":true}',
    ),
  ))
    values.push(value);
  assert.deepEqual(values, [{ text: "Héllo 👋" }]);
  await assert.rejects(async () => {
    for await (const value of readSse(
      streamed('data: {"large":"xxxxxxxx"}\n\n'),
      { totalBytes: 100, frameBytes: 10 },
    ))
      void value;
  }, /frame limit/);
  await assert.rejects(async () => {
    for await (const value of readSse(
      streamed("event: ping\n\nevent: ping\n\n"),
      { totalBytes: 16, frameBytes: 16 },
    ))
      void value;
  }, /size limit/);
});

test("workflow persists identity before completion and does not expose raw provider data", async () => {
  const events: ProviderEvent[] = [];
  const provider = createDifyWorkflow(
    live,
    live.bindings[0],
    async (url, options) => {
      assert.equal(
        url,
        `https://dify.example.test/v1/workflows/${workflowId}/run`,
      );
      assert.equal(options?.redirect, "error");
      assert.equal(options?.cache, "no-store");
      assert.deepEqual(JSON.parse(options?.body as string), {
        ...input,
        response_mode: "streaming",
      });
      return sse(started, {
        event: "workflow_finished",
        workflow_run_id: runId,
        task_id: taskId,
        data: detail,
      });
    },
  );
  const result = await provider.start(input, async (event) => {
    events.push(event);
  });
  assert.equal(result.kind, "ok");
  assert.equal(events[0].type, "identity");
  assert.equal(events[1].type, "execution");
  if (result.kind === "ok") {
    assert.deepEqual(result.value.outputs, detail.outputs);
    assert.equal(result.value.usage.totalTokens, 12);
    assert.equal(result.value.usage.cost, null);
  }
});

test("unknown POST outcome is never retried and known identities survive dropped streams", async () => {
  let calls = 0;
  const identities: ProviderEvent[] = [];
  const provider = createDifyWorkflow(live, live.bindings[0], async () => {
    calls++;
    return sse(started);
  });
  assert.equal(
    (
      await provider.start(input, async (event) => {
        identities.push(event);
      })
    ).kind,
    "unknown",
  );
  assert.equal(calls, 1);
  assert.equal(identities[0].type, "identity");
  const network = createDifyWorkflow(live, live.bindings[0], async () => {
    throw new Error("private url and secret");
  });
  assert.deepEqual(await network.start(input, async () => {}), {
    kind: "unknown",
    failure: "transport",
  });
});

test("provider error bodies stay private; retrieval failure never proves failed execution", async () => {
  const provider = createDifyWorkflow(
    live,
    live.bindings[0],
    async () => new Response("private-secret", { status: 401 }),
  );
  assert.deepEqual(await provider.start(input, async () => {}), {
    kind: "rejected",
    failure: "authentication",
  });
  assert.deepEqual(await provider.retrieve(runId), {
    kind: "unknown",
    failure: "authentication",
  });
});

test("mismatched publication or execution identity cannot complete a job", async () => {
  for (const badDetail of [
    { ...detail, workflow_id: taskId },
    { ...detail, id: taskId },
  ]) {
    const provider = createDifyWorkflow(live, live.bindings[0], async () =>
      sse(started, { event: "workflow_finished", data: badDetail }),
    );
    const events: ProviderEvent[] = [];
    assert.equal(
      (
        await provider.start(input, async (event) => {
          events.push(event);
        })
      ).kind,
      "unknown",
    );
    assert.equal(events.length, 1);
  }
});

test("persistence failure is propagated rather than hidden as a provider error", async () => {
  const provider = createDifyWorkflow(live, live.bindings[0], async () =>
    sse(started),
  );
  await assert.rejects(
    provider.start(input, async () => {
      throw new Error("database unavailable");
    }),
    /database unavailable/,
  );
});

test("paused and partial-success records retain their actual states", async () => {
  for (const status of ["paused", "partial-succeeded"]) {
    const provider = createDifyWorkflow(live, live.bindings[0], async () =>
      Response.json({ ...detail, status }),
    );
    const result = await provider.retrieve(runId);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.value.status, status);
  }
});

test("usage preserves exact decimal cost and unknown values, with stable opaque user IDs", () => {
  const usage = parseUsage(
    { total_price: "0.000000012345678901", currency: "USD", total_tokens: 20 },
    "node",
    taskId,
  );
  assert.equal(usage.cost?.amount, "0.000000012345678901");
  assert.equal(usage.totalTokens, 20);
  assert.equal(parseUsage({}, "execution", runId).cost, null);
  assert.equal(
    parseUsage({ total_price: "0", currency: "USD" }, "message", taskId).cost
      ?.amount,
    "0",
  );
  assert.equal(providerUser("owner"), providerUser("owner"));
  assert.notEqual(providerUser("owner"), providerUser("other"));
  assert.ok(!providerUser("owner").includes("owner"));
});

test("workflow retrieval preserves reported summary billing evidence", async () => {
  const provider = createDifyWorkflow(live, live.bindings[0], async () =>
    Response.json({
      ...detail,
      prompt_tokens: 8,
      completion_tokens: 4,
      total_price: "0.000001234567890123",
      currency: "USD",
    }),
  );
  const outcome = await provider.retrieve(runId);
  assert.equal(outcome.kind, "ok");
  if (outcome.kind !== "ok") return;
  assert.equal(outcome.value.usage.inputTokens, 8);
  assert.equal(outcome.value.usage.outputTokens, 4);
  assert.deepEqual(outcome.value.usage.cost, {
    amount: "0.000001234567890123",
    currency: "USD",
    source: "provider",
  });
});
