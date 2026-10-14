import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import {
  personaCompletionSchema,
  personaFieldsSchema,
} from "../../src/lib/contracts/personas";
import { parsePersonaCompletionConfig } from "../../src/lib/config/persona-completion";
import { personaCompletionProvider } from "../../src/lib/server/ai/persona-completion";
import {
  completionBinding,
  readPersonaCompletion,
  type CompletionRecord,
} from "../../src/lib/server/runs/persona-completion-settings";
import {
  guardPersona,
  personaChoices,
  snapshotPersona,
  type Persona,
} from "../../src/lib/server/runs/personas";

test("completion configuration rejects unsafe URLs, malformed settings and unsupported pricing", () => {
  assert.equal(parsePersonaCompletionConfig({}).mode, "disabled");
  const env = {
    PERSONA_COMPLETION_MODE: "live",
    PERSONA_COMPLETION_API_KEY: "fixture",
    APP_ENV: "local",
  };
  for (const url of [
    "http://example.test/v1",
    "https://user:password@example.test/v1",
    "https://example.test/v1?key=secret",
    "https://example.test/#fragment",
    "file:///tmp/api",
  ]) {
    assert.throws(() =>
      parsePersonaCompletionConfig({
        ...env,
        PERSONA_COMPLETION_BASE_URL: url,
      }),
    );
  }
  assert.equal(
    parsePersonaCompletionConfig({
      ...env,
      PERSONA_COMPLETION_BASE_URL: "http://127.0.0.1:3210/v1",
    }).baseUrl,
    "http://127.0.0.1:3210/v1",
  );
  assert.throws(() =>
    parsePersonaCompletionConfig({
      ...env,
      APP_ENV: "production",
      PERSONA_COMPLETION_BASE_URL: "http://127.0.0.1/v1",
    }),
  );
  for (const settings of [
    { enabled: true },
    { temperature: 3 },
    { maxOutputTokens: 0 },
    { tokenParameter: "unknown" },
    { instructions: " " },
  ])
    assert.equal(personaCompletionSchema.safeParse(settings).success, false);
  assert.equal(personaCompletionSchema.parse({}).maxOutputTokens, 1024);
  const persona = {
    name: "Parent",
    description: "",
    instructions: "Be thoughtful",
    enabled: true,
    archived: false,
  };
  assert.equal(
    personaFieldsSchema.safeParse({
      ...persona,
      pricing: {
        mode: "provider-cost",
        maxCredits: 1,
        currency: "USD",
        creditsPerCurrencyUnit: "1",
      },
    }).success,
    false,
  );
  assert.equal(
    personaFieldsSchema.safeParse({
      ...persona,
      pricing: {
        mode: "hybrid",
        maxCredits: 10,
        baseCredits: 1,
        usage: {
          mode: "tokens",
          rate: { basis: "total", creditsPerMillion: "1" },
        },
      },
    }).success,
    true,
  );
});

test("direct completion sends isolated messages, bounded settings and no workflow payload", async () => {
  const old = { ...process.env };
  const requests: {
    url: string;
    body: Record<string, unknown>;
    authorization?: string;
  }[] = [];
  let responseBody: unknown = {
    id: "cmpl-fixture",
    choices: [
      { finish_reason: "stop", message: { content: "  Exact answer\n" } },
    ],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  };
  let status = 200;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url!,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      authorization: req.headers.authorization,
    });
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...(status === 302 ? { Location: "/redirect-target" } : {}),
    });
    res.end(JSON.stringify(responseBody));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    APP_ENV: "local",
    PERSONA_COMPLETION_MODE: "live",
    PERSONA_COMPLETION_BASE_URL: `http://127.0.0.1:${port}/v1`,
    PERSONA_COMPLETION_API_KEY: "fixture-secret",
  });
  const settings = personaCompletionSchema.parse({
    enabled: true,
    model: "fixture-model",
  });
  function job() {
    const binding = completionBinding(settings, 1);
    return {
      binding,
      inputs: {
        persona: "A thoughtful parent",
        question: "Question {{literal}}",
        context: "Public history",
      },
      responder: {
        parentId: "parent",
        decisionId: "decision",
        completion: { revision: 1, settings: { ...settings }, binding },
      },
    };
  }
  try {
    const accepted = job();
    const provider = personaCompletionProvider(accepted);
    const run = () =>
      provider.start(
        { user: "opaque", inputs: accepted.inputs },
        async () => {},
      );
    const result = await run();
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.value.outputs?.answer, "  Exact answer\n");
      assert.equal(result.value.usage.totalTokens, 7);
      assert.equal(result.value.workflowId, null);
    }
    assert.equal(requests[0].url, "/v1/chat/completions");
    assert.equal(requests[0].authorization, "Bearer fixture-secret");
    assert.deepEqual(requests[0].body, {
      model: "fixture-model",
      messages: [
        { role: "system", content: settings.instructions },
        { role: "system", content: "A thoughtful parent" },
        {
          role: "user",
          content: JSON.stringify({
            question: accepted.inputs.question,
            context: accepted.inputs.context,
          }),
        },
      ],
      max_completion_tokens: 1024,
      stream: false,
      n: 1,
    });
    settings.tokenParameter = "max_tokens";
    settings.temperature = 0.4;
    await personaCompletionProvider(job()).start(
      { user: "opaque", inputs: accepted.inputs },
      async () => {},
    );
    assert.equal(requests[1].body.max_tokens, 1024);
    assert.equal(requests[1].body.temperature, 0.4);
    for (const message of [
      { content: "" },
      { content: null },
      { content: "answer", tool_calls: [{}] },
      { content: "answer", function_call: {} },
      { content: "answer", refusal: "refused" },
    ]) {
      responseBody = {
        id: "cmpl-invalid",
        choices: [{ finish_reason: "stop", message }],
      };
      const outcome = await run();
      assert.equal(outcome.kind, "ok");
      if (outcome.kind === "ok") assert.equal(outcome.value.status, "failed");
    }
    responseBody = {
      id: "cmpl-length",
      choices: [{ finish_reason: "length", message: { content: "partial" } }],
    };
    const truncated = await run();
    assert(truncated.kind === "ok" && truncated.value.status === "failed");
    for (const body of [{}, { id: "large", value: "x".repeat(1024 * 1024) }]) {
      responseBody = body;
      assert.equal((await run()).kind, "unknown");
    }
    status = 401;
    assert.equal((await run()).kind, "rejected");
    status = 429;
    assert.equal((await run()).kind, "rejected");
    status = 500;
    assert.equal((await run()).kind, "unknown");
    status = 302;
    const beforeRedirect = requests.length;
    assert.equal((await run()).kind, "unknown");
    assert.equal(requests.length, beforeRedirect + 1);
    assert(!requests.some((r) => r.url === "/redirect-target"));
    const count = requests.length;
    assert.equal((await provider.retrieve("cmpl-fixture")).kind, "unknown");
    assert.equal(
      (await provider.stop("cmpl-fixture", "opaque")).kind,
      "unknown",
    );
    assert.equal(requests.length, count);
    const controller = new AbortController();
    controller.abort();
    const timedOut = await provider.start(
      { user: "opaque", inputs: accepted.inputs },
      async () => {},
      controller.signal,
    );
    assert.equal(timedOut.kind, "unknown");
    const beforeRotation = job();
    process.env.PERSONA_COMPLETION_API_KEY = "different-secret";
    assert.throws(
      () => personaCompletionProvider(beforeRotation),
      /credentials changed/,
    );
  } finally {
    process.env = old;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Persona selection snapshots shared settings and rejects stale revisions transactionally", async () => {
  const old = { ...process.env };
  process.env.PERSONA_COMPLETION_MODE = "fake";
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("persona_completion");
  try {
    await readPersonaCompletion(db);
    assert.equal((await personaChoices(db)).length, 0);
    const settings = personaCompletionSchema.parse({
      enabled: true,
      model: "first-model",
    });
    await db
      .collection<CompletionRecord>("personaCompletionSettings")
      .updateOne(
        { _id: "shared" },
        {
          $set: { revision: 1, settings },
        },
      );
    const id = randomUUID();
    await db.collection<Persona>("personas").insertOne({
      _id: id,
      ...personaFieldsSchema.parse({
        name: "Parent",
        description: "",
        instructions: "Be thoughtful",
        enabled: true,
        archived: false,
      }),
      revision: 1,
      updatedAt: new Date(),
    });
    const choice = (await personaChoices(db)).find((p) => p.id === id)!;
    const answerer = { type: "persona" as const, ...choice };
    const snapshot = (await snapshotPersona(answerer, db))!;
    assert.equal(snapshot.completion.settings.model, "first-model");
    await client.withSession(async (session) => {
      await session.withTransaction(() => guardPersona(db, snapshot, session));
    });
    await db
      .collection<CompletionRecord>("personaCompletionSettings")
      .updateOne(
        { _id: "shared" },
        {
          $set: {
            revision: 2,
            settings: { ...settings, model: "second-model" },
          },
        },
      );
    await assert.rejects(
      snapshotPersona(answerer, db),
      /configuration changed/,
    );
    await client.withSession(async (session) => {
      await assert.rejects(
        session.withTransaction(() => guardPersona(db, snapshot, session)),
        /settings changed/,
      );
    });
    assert.equal(snapshot.completion.settings.model, "first-model");
    const next = (await personaChoices(db)).find((p) => p.id === id)!;
    assert.notEqual(next.configurationKey, choice.configurationKey);
    await db
      .collection<Persona>("personas")
      .updateOne({ _id: id }, { $inc: { revision: 1 } });
    await assert.rejects(
      snapshotPersona({ type: "persona", ...next }, db),
      /unavailable/,
    );
  } finally {
    process.env = old;
    await client.close();
    await repl.stop();
  }
});
