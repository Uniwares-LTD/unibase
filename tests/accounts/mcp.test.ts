import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import { parseMcpConfig } from "../../src/lib/config/mcp";
import { handleMcp } from "../../src/lib/server/mcp/handler";
import { runtimeRecord } from "../../src/lib/log-policy";
import { tools, type RegisteredTool } from "../../src/lib/server/mcp/tools";

test("MCP discovery avoids Dify's reserved structured output names", async () => {
  const config = parseMcpConfig(
    {
      ...env,
      MCP_CLIENTS_JSON: JSON.stringify([
        {
          id: "dify",
          tokenEnv: "MCP_TOKEN_DIFY",
          permissions: [
            "server:read",
            "reference:read",
            "demo:read",
            "run:read",
            "artifact:read",
            "artifact:write",
          ],
        },
      ]),
    },
    "http://localhost:3000",
  );
  const response = await handleMcp(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MCP_TOKEN_DIFY}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
    { config, appName: "Fixture", log() {} },
  );
  assert.equal(response.status, 200);
  const discovered = z
    .object({
      result: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            outputSchema: z.object({
              properties: z.record(z.string(), z.unknown()),
            }),
          }),
        ),
      }),
    })
    .parse(await response.json()).result.tools;
  assert.ok(discovered.some((tool) => tool.name === "read_artifact_v1"));
  for (const tool of discovered) {
    for (const name of Object.keys(tool.outputSchema.properties))
      assert.ok(
        !["text", "json", "files"].includes(name),
        `${tool.name} exposes reserved output ${name}`,
      );
  }
  const read = discovered.find((tool) => tool.name === "read_artifact_v1");
  z.object({ type: z.literal("string") }).parse(
    read?.outputSchema.properties.draftText,
  );
});

const token = "a".repeat(43);
const otherToken = "b".repeat(43);
const env = {
  MCP_ENABLED: "true",
  MCP_CLIENTS_JSON: JSON.stringify([
    {
      id: "dify",
      tokenEnv: "MCP_TOKEN_DIFY",
      permissions: ["server:read", "reference:read", "demo:read"],
    },
    {
      id: "limited",
      tokenEnv: "MCP_TOKEN_LIMITED",
      permissions: ["server:read"],
    },
  ]),
  MCP_TOKEN_DIFY: token,
  MCP_TOKEN_LIMITED: otherToken,
};

test("MCP configuration is opt-in, strict and does not reflect secrets", () => {
  assert.deepEqual(parseMcpConfig({}, "http://localhost:3000"), {
    enabled: false,
  });
  for (const patch of [
    { MCP_ENABLED: "yes" },
    { MCP_CLIENTS_JSON: "not-json" },
    { MCP_TOKEN_DIFY: "secret invalid value" },
    { MCP_ALLOWED_HOSTS_JSON: '["example.com/path"]' },
    { MCP_ALLOWED_HOSTS_JSON: '["evil.com@localhost"]' },
    { MCP_TOKEN_LIMITED: token },
  ])
    assert.throws(
      () => parseMcpConfig({ ...env, ...patch }, "http://localhost:3000"),
      /^Error: Invalid MCP configuration:/,
    );
  const config = parseMcpConfig(
    { ...env, MCP_ALLOWED_HOSTS_JSON: '["test.example.com"]' },
    "http://localhost:3000",
  );
  assert(config.enabled && config.origins.includes("https://test.example.com"));
});

test("MCP HTTP authorization, methods and input boundaries", async () => {
  const config = parseMcpConfig(env, "http://localhost:3000");
  const invoke = (
    headers: Record<string, string> = {},
    body = "{}",
    method = "POST",
  ) =>
    handleMcp(
      new Request("http://localhost:3000/api/mcp", {
        method,
        headers,
        ...(method === "GET" ? {} : { body }),
      }),
      { config, appName: "Fixture", log() {} },
    );
  assert.equal((await invoke()).status, 401);
  assert.equal((await invoke({ Cookie: "session=anything" })).status, 401);
  assert.equal((await invoke({ Authorization: "Bearer wrong" })).status, 401);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  assert.equal(
    (await invoke({ ...headers, Host: "evil.example" })).status,
    403,
  );
  assert.equal(
    (await invoke({ ...headers, Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await invoke(headers, "", "GET")).status, 405);
  assert.equal((await invoke(headers, "", "DELETE")).status, 405);
  assert.equal((await invoke(headers, "{")).status, 400);
  assert.equal((await invoke(headers, "x".repeat(65537))).status, 413);
  assert.equal(
    (await invoke({ ...headers, "MCP-Protocol-Version": "1900-01-01" })).status,
    400,
  );
  assert.equal(
    (
      await handleMcp(new Request("http://localhost:3000/api/mcp"), {
        config: { enabled: false },
        appName: "Fixture",
        log() {},
      })
    ).status,
    404,
  );
  const rotated = parseMcpConfig(
    { ...env, MCP_TOKEN_DIFY: "c".repeat(43) },
    "http://localhost:3000",
  );
  assert.equal(
    (
      await handleMcp(
        new Request("http://localhost:3000/api/mcp", {
          method: "POST",
          headers,
          body: "{}",
        }),
        { config: rotated, appName: "Fixture", log() {} },
      )
    ).status,
    401,
  );
});

test("MCP official client: real HTTP, discovery, calls and concurrent permission isolation", async () => {
  const events: unknown[] = [];
  const broken: RegisteredTool[] = [
    {
      name: "slow",
      description: "test",
      permission: "server:read",
      input: z.strictObject({}),
      output: z.strictObject({}),
      run: async (_input, context) => {
        await new Promise((resolve) =>
          context.signal.addEventListener("abort", resolve, { once: true }),
        );
        return {};
      },
    },
    {
      name: "invalid",
      description: "test",
      permission: "server:read",
      input: z.strictObject({}),
      output: z.strictObject({ value: z.string() }),
      run: async () => ({ secret: "must-not-escape" }),
    },
    {
      name: "large",
      description: "test",
      permission: "server:read",
      input: z.strictObject({}),
      output: z.strictObject({ value: z.string() }),
      run: async () => ({ value: "x".repeat(65536) }),
    },
  ];
  let origin = "";
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const request = new Request(`${origin}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handleMcp(request, {
        config: parseMcpConfig(env, origin),
        appName: "Fixture",
        registry: [...tools, ...broken],
        timeoutMs: 25,
        log: (e) =>
          events.push(
            runtimeRecord(e.event, {
              ...e,
              durationMs: performance.now() - e.started,
            }),
          ),
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const clients = [token, otherToken].map((secret) => ({
    client: new Client({ name: "test", version: "1" }),
    transport: new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }),
  }));
  try {
    await Promise.all(clients.map((c) => c.client.connect(c.transport)));
    const [full, limited] = await Promise.all(
      clients.map((c) => c.client.listTools()),
    );
    assert(full.tools.some((t) => t.name === "get_reference_document_v1"));
    const identity = await clients[0].client.callTool({
      name: "get_connection_info_v1",
      arguments: {},
    });
    assert.deepEqual(Object.keys(identity.structuredContent as object).sort(), [
      "environment",
      "origin",
      "project",
    ]);
    assert.equal(identity.isError, undefined);
    assert(!limited.tools.some((t) => t.name === "get_reference_document_v1"));
    const result = await clients[0].client.callTool({
      name: "get_reference_document_v1",
      arguments: { documentId: "unibase-demo" },
    });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /silver-lantern/);
    const catalog = await clients[0].client.callTool({
      name: "get_demo_catalog_v1",
      arguments: { category: "guides" },
    });
    assert.equal(catalog.isError, undefined);
    const catalogData = catalog.structuredContent as {
      items: { id: string }[];
    };
    assert.deepEqual(
      catalogData.items.map((item) => item.id),
      ["star-map", "notebook"],
    );
    const quote = await clients[0].client.callTool({
      name: "calculate_demo_quote_v1",
      arguments: { itemId: "telescope", quantity: 2, delivery: "express" },
    });
    assert.equal(quote.isError, undefined);
    assert.equal(
      (quote.structuredContent as { totalMinor: number }).totalMinor,
      10500,
    );
    for (const name of ["get_demo_catalog_v1", "calculate_demo_quote_v1"]) {
      assert(!limited.tools.some((tool) => tool.name === name));
      await assert.rejects(
        clients[1].client.callTool({ name, arguments: {} }),
        /not found/,
      );
    }
    for (const args of [
      { itemId: "telescope", quantity: 0, delivery: "express" },
      { itemId: "telescope", quantity: 21, delivery: "express" },
      { itemId: "telescope", quantity: 1.5, delivery: "standard" },
      { itemId: "unknown", quantity: 1, delivery: "standard" },
      {
        itemId: "star-map",
        quantity: 1,
        delivery: "standard",
        uid: "other-user",
      },
    ]) {
      const invalid = await clients[0].client.callTool({
        name: "calculate_demo_quote_v1",
        arguments: args,
      });
      assert.equal(invalid.isError, true);
    }
    const info = await clients[1].client.callTool({
      name: "get_server_info_v1",
      arguments: {},
    });
    assert.match(JSON.stringify(info), /Fixture/);
    await assert.rejects(
      clients[1].client.callTool({
        name: "get_reference_document_v1",
        arguments: { documentId: "unibase-demo" },
      }),
      /not found/,
    );
    const badInput = await clients[0].client.callTool({
      name: "get_reference_document_v1",
      arguments: { documentId: "../../.env.local" },
    });
    assert.equal(badInput.isError, true);
    for (const name of ["slow", "invalid", "large"]) {
      const failure = await clients[0].client.callTool({ name, arguments: {} });
      assert.equal(failure.isError, true);
      assert(!JSON.stringify(failure).includes("must-not-escape"));
    }
    const serialized = JSON.stringify(events);
    assert(!serialized.includes(token));
    assert(!serialized.includes("silver-lantern"));
    assert(serialized.includes('"outcome":"timeout"'));
    assert(
      events.some((event) => {
        const record = event as {
          event: string;
          status: number;
          outcome: string;
        };
        return (
          record.event === "mcp-request" &&
          record.status === 200 &&
          record.outcome === "rejected"
        );
      }),
    );
    assert(serialized.includes('"toolName":"get_reference_document_v1"'));
  } finally {
    await Promise.all(clients.map((c) => c.client.close()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("MCP diagnostic allowlist excludes headers, bodies and untrusted identifiers", () => {
  const record = runtimeRecord("mcp-tool", {
    clientId: "bad secret",
    toolName: "https://secret",
    outcome: "raw error",
    authorization: token,
    body: "private",
    requestId: "invalid",
  });
  assert(!JSON.stringify(record).includes("secret"));
  assert(!("body" in record));
  assert(!("clientId" in runtimeRecord("request", { clientId: "dify" })));
});

test("MCP supports legacy Streamable HTTP clients and cancellation", async () => {
  const config = parseMcpConfig(env, "http://localhost:3000");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-03-26",
  };
  const request = (body: unknown, signal?: AbortSignal) =>
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  const options = { config, appName: "Fixture", log() {} };
  const init = await handleMcp(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "legacy", version: "1" },
      },
    }),
    options,
  );
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.protocolVersion, "2025-03-26");
  const list = await handleMcp(
    request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    options,
  );
  assert.deepEqual(
    (await list.json()).result.tools
      .map((tool: { name: string }) => tool.name)
      .sort(),
    [
      "calculate_demo_quote_v1",
      "get_connection_info_v1",
      "get_demo_catalog_v1",
      "get_reference_document_v1",
      "get_server_info_v1",
    ],
  );
  const controller = new AbortController();
  let observedAbort = false;
  const tool: RegisteredTool = {
    name: "cancel_test",
    description: "Fixture",
    permission: "server:read",
    input: z.strictObject({}),
    output: z.strictObject({}),
    async run(_input, context) {
      await new Promise<void>((resolve) => {
        context.signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        );
        controller.abort();
      });
      return {};
    },
  };
  const response = await handleMcp(
    request(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "cancel_test", arguments: {} },
      },
      controller.signal,
    ),
    { ...options, registry: [tool] },
  );
  assert(observedAbort);
  assert.equal((await response.json()).result.isError, true);
});
