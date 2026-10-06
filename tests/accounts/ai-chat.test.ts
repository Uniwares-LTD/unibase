import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { parseDifyConfig } from "../../src/lib/config/dify";
import { createDifyChat } from "../../src/lib/server/ai/chat";
import {
  aiConversations,
  aiJobs,
  createAiIndexes,
  createAiJob,
} from "../../src/lib/server/ai/jobs";
import {
  bindingSnapshot,
  providerForJob,
} from "../../src/lib/server/ai/capabilities";
import { processOneAiJob } from "../../src/lib/server/ai/worker";
import {
  createCreditIndexes,
  grantCredits,
  readWallet,
} from "../../src/lib/server/store/credits";
import type { ProviderEvent } from "../../src/lib/server/ai/types";

const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const taskId = "00000000-0000-4000-8000-000000000003";
const live = parseDifyConfig({
  DIFY_MODE: "live",
  DIFY_BASE_URL: "https://dify.example.test/v1",
  DIFY_BINDINGS_JSON: JSON.stringify([
    {
      name: "assistant-chat",
      revision: "1",
      kind: "chat",
      apiKeyEnv: "DIFY_KEY_CHAT",
    },
  ]),
  DIFY_KEY_CHAT: "secret",
});
if (live.mode !== "live") throw new Error("Invalid fixture.");
const config = live;
function sse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("chat forwards prepared variables and attachments without overriding transport identity", async () => {
  const files = [
    { type: "image", transfer_method: "local_file", upload_file_id: taskId },
  ];
  const document = [
    {
      type: "document",
      transfer_method: "local_file",
      upload_file_id: messageId,
    },
  ];
  let sent: unknown;
  const provider = createDifyChat(
    config,
    config.bindings[0],
    { user: "opaque-user", conversationId },
    async (_url, options) => {
      sent = JSON.parse(options?.body as string);
      return new Response(null, { status: 400 });
    },
  );
  await provider.start(
    {
      user: "opaque-user",
      inputs: {
        prompt: "Summarize",
        language: "fa",
        document,
        files,
        user: "input-variable",
        conversation_id: "input-variable",
        response_mode: "input-variable",
      },
    },
    async () => {},
  );
  assert.deepEqual(sent, {
    query: "Summarize",
    files,
    inputs: {
      language: "fa",
      document,
      user: "input-variable",
      conversation_id: "input-variable",
      response_mode: "input-variable",
    },
    user: "opaque-user",
    conversation_id: conversationId,
    response_mode: "streaming",
    auto_generate_name: false,
  });
});

test("chat captures durable identities and usage, with no automatic POST retry", async () => {
  let requests = 0;
  const provider = createDifyChat(
    config,
    config.bindings[0],
    { user: "opaque-user", conversationId: null },
    async (_url, options) => {
      requests++;
      assert.deepEqual(JSON.parse(options?.body as string), {
        inputs: {},
        query: "hello",
        user: "opaque-user",
        conversation_id: "",
        response_mode: "streaming",
        auto_generate_name: false,
      });
      return sse([
        {
          event: "message",
          message_id: messageId,
          conversation_id: conversationId,
          task_id: taskId,
          answer: "Hello ",
        },
        {
          event: "message",
          message_id: messageId,
          conversation_id: conversationId,
          task_id: taskId,
          answer: "world",
        },
        {
          event: "message_end",
          message_id: messageId,
          conversation_id: conversationId,
          task_id: taskId,
          metadata: {
            usage: {
              prompt_tokens: 4,
              completion_tokens: 2,
              total_tokens: 6,
              total_price: "0.000001",
              currency: "USD",
            },
          },
        },
      ]);
    },
  );
  const events: ProviderEvent[] = [];
  const outcome = await provider.start(
    { user: "opaque-user", inputs: { prompt: "hello" } },
    async (event) => {
      events.push(event);
    },
  );
  assert.equal(requests, 1);
  assert.equal(outcome.kind, "ok");
  assert.deepEqual(events[0], {
    type: "identity",
    runId: messageId,
    taskId,
    providerConversationId: conversationId,
  });
  if (outcome.kind === "ok") {
    assert.equal(outcome.value.outputs?.text, "Hello world");
    assert.equal(outcome.value.usage.cost?.amount, "0.000001");
  }
});

test("chatflow persists late workflow identity and waits for terminal workflow evidence", async () => {
  const workflowRunId = "00000000-0000-4000-8000-000000000004";
  const workflowId = "00000000-0000-4000-8000-000000000005";
  for (const status of ["succeeded", "failed"] as const) {
    const events: ProviderEvent[] = [];
    const provider = createDifyChat(
      config,
      config.bindings[0],
      { user: "opaque-user", conversationId: null },
      async () =>
        sse([
          {
            event: "agent_message",
            message_id: messageId,
            task_id: taskId,
            conversation_id: conversationId,
            answer: "Draft",
          },
          { event: "workflow_started", workflow_run_id: workflowRunId },
          { event: "message", answer: "Final answer" },
          {
            event: "message_end",
            metadata: { usage: { total_price: "0.0123", currency: "USD" } },
          },
          {
            event: "workflow_finished",
            workflow_run_id: workflowRunId,
            data: { status, workflow_id: workflowId },
          },
        ]),
    );
    const outcome = await provider.start(
      { user: "opaque-user", inputs: { prompt: "hello" } },
      async (event) => {
        events.push(event);
      },
    );
    assert.equal(outcome.kind, "ok");
    if (outcome.kind === "ok") {
      assert.equal(outcome.value.status, status);
      assert.equal(outcome.value.outputs?.text, "Final answer");
      assert.equal(outcome.value.usage.cost?.amount, "0.0123");
    }
    const identities = events.filter((event) => event.type === "identity");
    assert.equal(identities.length, 2);
    assert.equal(identities[1].workflowRunId, workflowRunId);
    assert.equal(
      events.filter((event) => event.type === "execution").length,
      1,
    );
  }
});

test("chat recovery preserves history evidence without assuming a partial reply completed", async () => {
  const provider = createDifyChat(
    config,
    config.bindings[0],
    { user: "opaque-user", conversationId },
    async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.searchParams.get("user"), "opaque-user");
      assert.equal(parsed.searchParams.get("conversation_id"), conversationId);
      return Response.json({
        has_more: false,
        data: [
          {
            id: messageId,
            conversation_id: conversationId,
            answer: "Saved answer",
            status: "normal",
            total_price: "1E-7",
            currency: "USD",
            total_tokens: 9,
          },
        ],
      });
    },
  );
  const result = await provider.retrieve(messageId);
  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") {
    assert.equal(result.evidence?.outputs?.text, "Saved answer");
    assert.equal(result.evidence?.usage.cost?.amount, "0.0000001");
  }
});

test("conversation ownership and one active turn are enforced atomically with credits", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  try {
    const db = client.db("ai_chat");
    await createAiIndexes(db);
    await createCreditIndexes(db);
    const actor = { uid: "owner", authTime: Math.floor(Date.now() / 1000) };
    const other = { uid: "other", authTime: actor.authTime };
    for (const user of [actor, other])
      await grantCredits(db, user.uid, "seed", {
        amount: 20,
        source: "purchase",
        reference: `fixture-${user.uid}`,
      });
    const request = {
      capability: "assistant-chat",
      capabilityVersion: "1",
      inputs: { prompt: "hello" },
      source: null,
      credits: 1,
      binding: bindingSnapshot("assistant-chat", { mode: "fake" }),
    };
    const first = await createAiJob(db, actor, "first", request);
    assert.throws(() => providerForJob(first, config), {
      code: "AI_BINDING_CHANGED",
    });
    const liveJob = {
      ...first,
      binding: bindingSnapshot("assistant-chat", config),
    };
    assert.doesNotThrow(() => providerForJob(liveJob, config));
    assert.throws(
      () =>
        providerForJob(liveJob, {
          ...config,
          bindings: config.bindings.map((binding) => ({
            ...binding,
            apiKey: "rotated-key",
          })),
        }),
      { code: "AI_BINDING_CHANGED" },
    );
    assert.ok(first.conversationId);
    await assert.rejects(
      createAiJob(db, actor, "too-soon", {
        ...request,
        conversationId: first.conversationId,
      }),
      { code: "AI_CONVERSATION_BUSY" },
    );
    assert.equal((await readWallet(db, actor.uid)).reserved, 1);
    await assert.rejects(
      createAiJob(db, other, "cross-user", {
        ...request,
        conversationId: first.conversationId,
      }),
      { code: "AI_CONVERSATION_NOT_FOUND" },
    );
    assert.equal((await readWallet(db, other.uid)).reserved, 0);
    const dependencies = {
      provider: (job: Parameters<typeof providerForJob>[0]) =>
        providerForJob(job, { mode: "fake" }),
      authorize: async () => true,
      validateOutput: () => true,
    };
    await processOneAiJob(db, dependencies);
    const conversation = await aiConversations(db).findOne({
      _id: first.conversationId,
    });
    assert.ok(conversation?.providerId);
    assert.equal(conversation.activeJobId, null);
    const second = await createAiJob(db, actor, "second", {
      ...request,
      conversationId: first.conversationId,
      inputs: { prompt: "continue" },
    });
    assert.equal(second.providerConversationId, conversation.providerId);
    await processOneAiJob(db, dependencies);
    assert.equal(
      (await aiJobs(db).findOne({ _id: second._id }))?.status,
      "succeeded",
    );
    assert.equal((await readWallet(db, actor.uid)).balance, 18);
  } finally {
    await client.close();
    await repl.stop();
  }
});
