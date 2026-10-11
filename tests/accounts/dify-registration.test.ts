import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { AppError } from "../../src/lib/auth-policy";
import {
  inspectDifyWorkflow,
  verifyMcpTools,
} from "../../src/lib/server/runs/dify-capabilities";
import {
  registerDifyOrchestrator,
  discoverDifyOrchestrators,
  registrationStatus,
} from "../../src/lib/server/runs/registration";
import type { difyJson } from "../../src/lib/server/runs/dify-console-client";

const graph = () => ({
  nodes: [
    {
      id: "start",
      data: {
        type: "start",
        variables: [
          {
            variable: "prompt",
            label: "Your prompt",
            type: "paragraph",
            required: true,
            max_length: 4000,
          },
        ],
      },
    },
    {
      id: "generate",
      data: {
        type: "llm",
        model: { name: "existing-model" },
        prompt_template: [{ text: "Existing instructions" }],
      },
    },
    {
      id: "end",
      position: { x: 900, y: 100 },
      data: {
        type: "end",
        outputs: [{ variable: "text", value_selector: ["generate", "text"] }],
      },
    },
  ],
  edges: [
    { id: "first", source: "start", target: "generate" },
    {
      id: "last",
      source: "generate",
      target: "end",
      data: { custom: "retained" },
    },
  ],
});
test("Capability inspection preserves the graph, permits no inputs and respects optional prompts", () => {
  const source = graph();
  const original = structuredClone(source);
  assert.deepEqual(
    inspectDifyWorkflow(source).inputs.map((field) => field.name),
    ["prompt"],
  );
  assert.deepEqual(source, original);
  source.nodes[0].data.variables = [];
  assert.deepEqual(inspectDifyWorkflow(source).inputs, []);
  assert.deepEqual(inspectDifyWorkflow(source).legacyInputs, []);
  source.nodes[0].data.variables = [
    {
      variable: "prompt",
      label: "Prompt",
      type: "paragraph",
      required: false,
      max_length: 4000,
    },
  ];
  assert.equal(inspectDifyWorkflow(source).inputs[0].required, false);
  source.nodes[0].data.variables![0].type = "file-list";
  assert.throws(() => inspectDifyWorkflow(source), /Start controls/);
});

test("Human Input requires WebApp delivery and a supported Generative UI contract", () => {
  const source: { nodes: { id: string; data: Record<string, unknown> }[] } =
    graph();
  const human = {
    type: "human-input",
    delivery_methods: [{ type: "webapp", enabled: true }],
    form_content: "Choose a direction",
    inputs: [{ type: "paragraph", output_variable_name: "response" }],
    user_actions: [{ id: "continue", title: "Continue" }],
  };
  source.nodes.push({ id: "human", data: human });
  assert.doesNotThrow(() => inspectDifyWorkflow(source));
  human.delivery_methods[0].enabled = false;
  assert.throws(() => inspectDifyWorkflow(source), /WebApp delivery/);
  human.delivery_methods[0].enabled = true;
  human.form_content = "```unibase-ui\n{}\n```\n{{#$output.response#}}";
  assert.throws(() => inspectDifyWorkflow(source), /Generative UI/);
});

test("MCP checks read the authorized tool catalog without executing read or write tools", async () => {
  const selected = [
    { providerId: "workspace_mcp", toolName: "fetch" },
    { providerId: "workspace_mcp", toolName: "save" },
  ];
  let calls = 0;
  const request: typeof difyJson = async (path, options) => {
    calls++;
    assert.equal(path, "/workspaces/current/tools/mcp");
    assert.equal(options?.body, undefined);
    return [
      {
        id: "workspace_mcp",
        is_team_authorization: true,
        tools: [{ name: "fetch" }, { name: "save" }],
      },
    ];
  };
  await verifyMcpTools(selected, request);
  assert.equal(calls, 1);
  await assert.rejects(
    verifyMcpTools(selected, async () => [
      {
        id: "workspace_mcp",
        is_team_authorization: true,
        tools: [{ name: "fetch" }],
      },
    ]),
    /synchronize/,
  );
});

test("Formless registration: read-only checks, retries, authorization and no partial enablement", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("dify_registration");
  const actor = { uid: "admin", auth_time: Math.floor(Date.now() / 1000) };
  const access = db.collection<Document & { _id: string }>("accountAccess");
  await access.insertOne({
    _id: actor.uid,
    role: "admin",
    status: "active",
    notBefore: 0,
    revision: 0,
  });
  const env = {
    DIFY_MODE: "live",
    DIFY_CONSOLE_URL: "https://dify.example.test/console/api",
    DIFY_BASE_URL: "https://dify.example.test/v1",
    DIFY_MANAGEMENT_KEY: "private-management",
    DIFY_WORKSPACE_ID: randomUUID(),
  };
  function fixture(
    options: {
      existing?: boolean;
      rejectKey?: boolean;
      unpublished?: boolean;
      rejectMcp?: boolean;
      rejectParameters?: boolean;
      onPublishRead?: () => Promise<void>;
    } = {},
  ) {
    const appId = randomUUID();
    const published = {
      id: randomUUID(),
      graph: graph(),
      hash: "before",
      features: { retained: true },
      conversation_variables: [
        {
          name: "existing",
          value: "private-conversation",
          id: randomUUID(),
          value_type: "string",
        },
      ],
      environment_variables: [{ name: "secret", value: "private-secret" }],
    };
    let keys = options.existing
      ? [{ id: randomUUID(), token: "app-existing-private-canary" }]
      : [];
    const counts = { keys: 0, reads: 0 };
    if (options.rejectMcp)
      published.graph.nodes.push({
        id: "mcp",
        data: {
          type: "tool",
          provider_type: "mcp",
          provider_id: "unibase",
          tool_name: "fetch",
        },
      } as never);
    const request: typeof difyJson = async (path, config = {}) => {
      assert.ok((config.timeoutMs ?? 30000) <= 30000);
      if (path.startsWith("/apps?"))
        return {
          data: [{ id: appId, name: "Example", mode: "workflow" }],
          has_more: false,
        };
      if (path === `/apps/${appId}`)
        return {
          mode: "workflow",
          name: "Example",
          description: "Original description",
        };
      if (path.endsWith("/api-keys")) {
        if (config.body !== undefined) {
          counts.keys++;
          if (options.rejectKey)
            throw new AppError(
              "DIFY_KEY_CREATION_REJECTED",
              "Key creation rejected",
              409,
            );
          keys = [{ id: randomUUID(), token: "app-created-private-canary" }];
          return keys[0];
        }
        return { data: keys };
      }
      if (path.endsWith("/publish")) {
        assert.equal(config.body, undefined, "Registration must never publish");
        counts.reads++;
        await options.onPublishRead?.();
        return options.unpublished ? null : structuredClone(published);
      }
      if (path === "/workspaces/current/tools/mcp")
        return [
          {
            id: "unibase",
            is_team_authorization: !options.rejectMcp,
            tools: [{ name: "fetch" }],
          },
        ];
      if (path === "/info") return { mode: "workflow" };
      if (path === "/parameters") {
        if (options.rejectParameters)
          throw new AppError("DIFY_REJECTED", "Parameters unavailable", 502);
        const variables = published.graph.nodes[0].data.variables ?? [];
        return {
          user_input_form: variables.map((field) => ({ [field.type]: field })),
        };
      }
      throw new Error(`Unexpected fixture path ${path}`);
    };
    return { appId, options, request, counts };
  }
  try {
    await t.test(
      "one app ID enables a complete definition without configuration fields",
      async () => {
        const f = fixture({ existing: true });
        const result = await registerDifyOrchestrator(
          f.appId,
          actor,
          db,
          f.request,
          env,
        );
        assert.equal(result.status, "ready");
        assert.equal(f.counts.keys, 0);
        const record = await db
          .collection<Document & { _id: string }>("orchestrators")
          .findOne({ _id: result.orchestratorId });
        assert.equal(record!.validated, true);
        assert.equal(record!.definition.enabled, true);
        assert.deepEqual(
          record!.definition.inputs.map(
            (field: { name: string }) => field.name,
          ),
          ["prompt"],
        );
        assert.equal(record!.definition.pricing, null);
        assert.equal(record!.definition.recovery, null);
        assert.equal(
          (await discoverDifyOrchestrators(db, f.request, env)).apps[0].status,
          "ready",
        );
        await registerDifyOrchestrator(f.appId, actor, db, f.request, env);
        assert.equal(f.counts.keys, 0);
        assert.equal(
          (await db
            .collection<Document & { _id: string }>("orchestrators")
            .findOne({ _id: result.orchestratorId }))!.revision,
          record!.revision,
        );
        await db
          .collection("difyCredentials")
          .updateOne({ appId: f.appId }, { $set: { ciphertext: "tampered" } });
        assert.equal(
          (await registrationStatus(f.appId, db, env)).status,
          "failed",
        );
        assert.equal(
          (await discoverDifyOrchestrators(db, f.request, env)).apps[0].status,
          "failed",
        );
        assert.equal(
          (await registerDifyOrchestrator(f.appId, actor, db, f.request, env))
            .status,
          "ready",
        );
        const stored =
          JSON.stringify(
            await db.collection("difyCredentials").find().toArray(),
          ) +
          JSON.stringify(
            await db.collection("orchestratorRegistrations").find().toArray(),
          ) +
          JSON.stringify(await db.collection("auditEvents").find().toArray());
        assert.ok(
          !stored.includes("private-canary") &&
            !stored.includes("private-conversation") &&
            !stored.includes("private-secret"),
        );
      },
    );
    await t.test(
      "creates only a missing key and never changes the workflow",
      async () => {
        const f = fixture();
        await registerDifyOrchestrator(f.appId, actor, db, f.request, env);
        await registerDifyOrchestrator(f.appId, actor, db, f.request, env);
        assert.equal(f.counts.keys, 1);
      },
    );
    await t.test(
      "failed credentials, capability and input verification never enable a partial registration",
      async () => {
        for (const options of [
          { rejectKey: true },
          { unpublished: true },
          { rejectMcp: true },
          { rejectParameters: true },
        ]) {
          const f = fixture(options);
          await assert.rejects(
            registerDifyOrchestrator(f.appId, actor, db, f.request, env),
          );
          assert.equal(
            await db
              .collection<Document & { _id: string }>("orchestrators")
              .countDocuments({ "definition.appId": f.appId }),
            0,
          );
          assert.equal(
            (await registrationStatus(f.appId, db, env)).status,
            "failed",
          );
        }
      },
    );
    await t.test("concurrent registration is serialized", async () => {
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const f = fixture({
        onPublishRead: async () => {
          entered();
          await blocked;
        },
      });
      const first = registerDifyOrchestrator(
        f.appId,
        actor,
        db,
        f.request,
        env,
      );
      await started;
      try {
        await assert.rejects(
          registerDifyOrchestrator(f.appId, actor, db, f.request, env),
          /already being registered/,
        );
      } finally {
        release();
      }
      await first;
      assert.equal(f.counts.keys, 1);
    });
    await t.test(
      "revoked administrator cannot contact the provider",
      async () => {
        await access.updateOne(
          { _id: actor.uid },
          { $set: { role: "member" } },
        );
        await assert.rejects(
          registerDifyOrchestrator(
            randomUUID(),
            actor,
            db,
            async () => {
              throw new Error("Unexpected provider call");
            },
            env,
          ),
          /Administrator/,
        );
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
