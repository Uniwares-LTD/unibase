import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
export const existingApp = "10000000-0000-4000-8000-000000000001";
export const emptyApp = "10000000-0000-4000-8000-000000000002";
export const workflowId = "20000000-0000-4000-8000-000000000001";
export const existingToken = "app-existing-http-canary";
export const createdToken = "app-created-http-canary";
export async function difyKeysFixture() {
  const keys = new Map([
    [
      existingApp,
      [{ id: "30000000-0000-4000-8000-000000000001", token: existingToken }],
    ],
    [emptyApp, []],
  ]);
  let creates = 0;
  let draftUpdates = 0;
  let publishes = 0;
  let executions = 0;
  let imports = 0;
  let mcpCalls = 0;
  const names = new Map([
    [existingApp, "Existing key workflow"],
    [emptyApp, "New key workflow"],
  ]);
  const forms = new Map();
  const runs = new Map();
  const workflows = new Map(
    [existingApp, emptyApp].map((appId) => [
      appId,
      {
        id: workflowId,
        features: {},
        graph: {
          nodes: [
            {
              id: "start",
              data: {
                type: "start",
                variables: (appId === existingApp
                  ? ["unibase_run_id", "unibase_attempt_id", "prompt"]
                  : []
                ).map((variable) => ({
                  variable,
                  label: variable,
                  type: "text-input",
                  required: true,
                  max_length: 256,
                })),
              },
            },
            {
              id: "generate",
              data: { type: "code", outputs: { text: { type: "string" } } },
            },
            {
              id: "end",
              data: {
                type: "end",
                outputs: [
                  { variable: "text", value_selector: ["generate", "text"] },
                ],
              },
            },
          ],
          edges: [
            { id: "start-generate", source: "start", target: "generate" },
            { id: "generate-end", source: "generate", target: "end" },
          ],
        },
      },
    ]),
  );
  const drafts = new Map(
    [...workflows].map(([id, workflow]) => [
      id,
      {
        ...structuredClone(workflow),
        hash: "initial-hash",
        conversation_variables: [],
      },
    ]),
  );
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const send = (body, status = 200) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (path.startsWith("/console/api/")) {
      if (
        request.headers.authorization !== "Bearer management-http-canary" ||
        request.headers["x-workspace-id"] !==
          "40000000-0000-4000-8000-000000000001"
      )
        return send({}, 403);
      if (path === "/console/api/fixture/stats")
        return send({
          creates,
          draftUpdates,
          publishes,
          executions,
          ...(imports ? { imports, mcpCalls } : {}),
        });
      if (path === "/console/api/workspaces/current/tools/mcp")
        return send([
          {
            id: "workspace_mcp",
            is_team_authorization: true,
            tools: [{ name: "get_reference_document_v1" }],
          },
        ]);
      if (path === "/console/api/apps/imports" && request.method === "POST") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (body.app_id) return send({}, 400);
        const dsl = JSON.parse(body.yaml_content),
          appId = randomUUID();
        imports++;
        names.set(appId, dsl.app.name);
        keys.set(appId, []);
        drafts.set(appId, {
          ...dsl.workflow,
          id: randomUUID(),
          hash: "created-hash",
        });
        return send({ status: "completed", app_id: appId, id: randomUUID() });
      }
      if (path === "/console/api/apps")
        return send({
          data: [...names].map(([id, name]) => ({
            id,
            name,
            mode: "workflow",
          })),
          has_more: false,
        });
      const match = /^\/console\/api\/apps\/([a-f0-9-]+)(.*)$/.exec(path);
      if (!match || !keys.has(match[1])) return send({}, 404);
      if (!match[2])
        return send({
          name: names.get(match[1]),
          description: "Local workflow fixture",
          mode: "workflow",
        });
      const traceMatch =
        /^\/workflow-runs\/([a-f0-9-]+)\/node-executions$/.exec(match[2]);
      if (traceMatch) {
        const saved = runs.get(traceMatch[1]);
        if (!saved || saved.appId !== match[1]) return send({}, 404);
        return send({
          data: workflows.get(match[1]).graph.nodes.map((n) => ({
            id: `${saved.result.id}-${n.id}`,
            node_id: n.id,
            title: n.data.title ?? (n.id === "generate" ? "Generate" : n.id),
            status: "succeeded",
            elapsed_time: 0.1,
          })),
        });
      }
      if (match[2] === "/workflows/draft") {
        if (request.method === "POST") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks));
          if (body.hash !== drafts.get(match[1]).hash) return send({}, 400);
          draftUpdates++;
          drafts.set(match[1], {
            ...drafts.get(match[1]),
            ...body,
            hash: `hash-${draftUpdates}`,
          });
          return send({ result: "success", hash: `hash-${draftUpdates}` });
        }
        return send(drafts.get(match[1]));
      }
      if (match[2] === "/workflows/publish") {
        if (request.method === "POST") {
          publishes++;
          workflows.set(match[1], {
            ...structuredClone(drafts.get(match[1])),
            id: "20000000-0000-4000-8000-000000000002",
          });
          return send({ result: "success" });
        }
        return send(workflows.get(match[1]) ?? null);
      }
      if (match[2] === "/api-keys") {
        if (request.method === "POST") {
          creates++;
          const key = {
            id: "30000000-0000-4000-8000-000000000002",
            token:
              match[1] === emptyApp ? createdToken : `app-created-${match[1]}`,
          };
          keys.get(match[1]).push(key);
          return send(key, 201);
        }
        return send({ data: keys.get(match[1]) });
      }
    } else {
      const selectedApp = [...keys].find(([, rows]) =>
        rows.some((k) => request.headers.authorization === `Bearer ${k.token}`),
      )?.[0];
      if (!selectedApp) return send({}, 401);
      if (path === "/v1/info")
        return send({
          name: "Fixture workflow",
          description: "Local API-key fixture",
          mode: "workflow",
        });
      if (path === "/v1/parameters")
        return send({
          user_input_form: workflows
            .get(selectedApp)
            .graph.nodes[0].data.variables.map((field) => ({
              [field.type]: field,
            })),
        });
      const workflow = workflows.get(selectedApp);
      const formMatch = /^\/v1\/form\/human_input\/([a-f0-9-]+)$/.exec(path);
      if (formMatch) {
        const saved = forms.get(formMatch[1]);
        if (!saved || saved.appId !== selectedApp) return send({}, 404);
        if (request.method === "POST") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks));
          if (
            body.user !== saved.user ||
            body.action !== "continue" ||
            typeof body.inputs?.response !== "string"
          )
            return send({}, 400);
          saved.filled = true;
          saved.response = body.inputs.response;
          saved.result.status = "running";
          saved.result.outputs = {
            text: `MCP document received. Selected: ${body.inputs.response.includes("detailed") ? "Detailed" : "Brief"}\n\nDemo observatory visitor guide: Cedar Observatory opens at 19:30 on Fridays.`,
          };
          return send({ result: "success" });
        }
        return send({
          ...saved.form,
          expiration_time: Math.floor(Date.now() / 1000) + 3600,
          is_submitted: saved.filled,
          selected_action_id: saved.filled ? "continue" : null,
          submitted_data: saved.filled ? { response: saved.response } : null,
        });
      }
      const streamMatch = /^\/v1\/workflow\/([a-f0-9-]+)\/events$/.exec(path);
      if (streamMatch) {
        const saved = runs.get(streamMatch[1]);
        if (!saved || saved.appId !== selectedApp) return send({}, 404);
        saved.result.status = "succeeded";
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          `data: ${JSON.stringify({ event: "node_finished", workflow_run_id: saved.result.id, task_id: saved.taskId, data: { id: randomUUID(), node_id: "compose", title: "Compose result", status: "succeeded", elapsed_time: 0.1 } })}\n\ndata: ${JSON.stringify({ event: "workflow_finished", workflow_run_id: saved.result.id, task_id: saved.taskId, data: saved.result })}\n\n`,
        );
        return;
      }
      if (
        /^\/v1\/workflows\/[a-f0-9-]+\/run$/.test(path) &&
        request.method === "POST"
      ) {
        if (path !== `/v1/workflows/${workflow.id}/run`) return send({}, 404);
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        const declared = workflow.graph.nodes[0].data.variables;
        if (
          !body.inputs ||
          Object.keys(body.inputs).some(
            (name) => !declared.some((field) => field.variable === name),
          ) ||
          declared.some(
            (field) => field.required && !body.inputs[field.variable],
          )
        )
          return send({}, 400);
        executions++;
        const runId = randomUUID();
        const taskId = randomUUID();
        const nodeId = randomUUID();
        const human = workflow.graph.nodes.find(
          (n) => n.data.type === "human-input",
        );
        if (human) {
          const reference = workflow.graph.nodes.find(
            (n) => n.data.provider_type === "mcp",
          );
          if (
            reference?.data.tool_name !== "get_reference_document_v1" ||
            reference.data.tool_parameters.documentId.value !== "unibase-demo"
          )
            return send({}, 400);
          mcpCalls++;
          const token = randomUUID();
          const result = {
            id: runId,
            workflow_id: workflow.id,
            status: "paused",
            outputs: {},
            total_tokens: 0,
            elapsed_time: 0.1,
          };
          const saved = {
            appId: selectedApp,
            result,
            taskId,
            user: body.user,
            form: human.data,
            filled: false,
          };
          runs.set(runId, saved);
          forms.set(token, saved);
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end(
            [
              { event: "workflow_started", data: { id: runId } },
              {
                event: "node_finished",
                data: {
                  id: nodeId,
                  node_id: "reference",
                  title: "Fetch demo document through MCP",
                  status: "succeeded",
                  elapsed_time: 0.1,
                },
              },
              {
                event: "human_input_required",
                data: {
                  node_id: human.id,
                  node_title: human.data.title,
                  form_token: token,
                },
              },
              { event: "workflow_paused", data: { id: runId } },
            ]
              .map(
                (e) =>
                  `data: ${JSON.stringify({ ...e, workflow_run_id: runId, task_id: taskId })}\n\n`,
              )
              .join(""),
          );
          return;
        }
        const result = {
          id: runId,
          workflow_id: workflow.id,
          status: "succeeded",
          outputs: {
            text: `Result: ${body.inputs.prompt ?? "Inline workflow prompt"}`,
          },
          total_tokens: 0,
          elapsed_time: 0.1,
        };
        runs.set(runId, { appId: selectedApp, result });
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          `data: ${JSON.stringify({ event: "workflow_started", workflow_run_id: runId, task_id: taskId, data: { id: runId } })}\n\ndata: ${JSON.stringify({ event: "node_started", workflow_run_id: runId, task_id: taskId, data: { id: nodeId, node_id: "generate", title: "Generate" } })}\n\ndata: ${JSON.stringify({ event: "node_finished", workflow_run_id: runId, task_id: taskId, data: { id: nodeId, node_id: "generate", title: "Generate", status: "succeeded", elapsed_time: 0.1 } })}\n\ndata: ${JSON.stringify({ event: "workflow_finished", workflow_run_id: runId, task_id: taskId, data: result })}\n\n`,
        );
        return;
      }
      const runMatch = /^\/v1\/workflows\/run\/([a-f0-9-]+)$/.exec(path);
      if (runMatch) {
        const saved = runs.get(runMatch[1]);
        return saved?.appId === selectedApp
          ? send(saved.result)
          : send({}, 404);
      }
    }
    send({}, 404);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    env: {
      DIFY_KEYS_TEST: "1",
      DIFY_BASE_URL: `${url}/v1`,
      DIFY_CONSOLE_URL: `${url}/console/api`,
      DIFY_MANAGEMENT_KEY: "management-http-canary",
      DIFY_WORKSPACE_ID: "40000000-0000-4000-8000-000000000001",
      DIFY_CREDENTIAL_ENCRYPTION_KEY: "",
    },
  };
}
