import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { AppError } from "../../src/lib/auth-policy";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createDifyOrchestrator } from "../../src/lib/server/runs/creation";
import {
  orchestratorTemplate,
  orchestratorTemplates,
} from "../../src/lib/server/runs/templates";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import type { difyJson } from "../../src/lib/server/runs/dify-console-client";

test("Starter declares no inputs and includes MCP, Generative UI and native result", () => {
  const dsl = orchestratorTemplate("document-summary").build("workspace_mcp");
  const fit = inspectDifyWorkflow(dsl.workflow.graph);
  assert.deepEqual(fit.inputs, []);
  assert.deepEqual(fit.legacyInputs, []);
  assert.deepEqual(fit.mcpTools, [
    { providerId: "workspace_mcp", toolName: "get_reference_document_v1" },
  ]);
  assert.equal(
    dsl.workflow.graph.edges.find((e) => e.source === "decision")?.sourceHandle,
    "continue",
  );
  assert.equal(
    dsl.workflow.graph.nodes.find((n) => n.id === "compose")?.data.type,
    "llm",
  );
});
test("Creation imports only a new app, resumes safely and checks fresh admin access", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  const db = client.db("creation");
  const actor = { uid: "admin", auth_time: Math.floor(Date.now() / 1000) };
  const access = db.collection<Document & { _id: string }>("accountAccess");
  await access.insertOne({
    _id: actor.uid,
    role: "admin",
    status: "active",
    notBefore: 0,
  });
  const env = {
    DIFY_MODE: "live",
    DIFY_CONSOLE_URL: "https://dify.test/console/api",
    DIFY_BASE_URL: "https://dify.test/v1",
    DIFY_WORKSPACE_ID: randomUUID(),
    DIFY_MANAGEMENT_KEY: "private-management",
  };
  function fixture(
    options: {
      missing?: boolean;
      lost?: boolean;
      registerFail?: boolean;
      revoke?: boolean;
      changed?: boolean;
      rejected?: boolean;
      deleted?: boolean;
      siteFail?: boolean;
      allTools?: boolean;
    } = {},
  ) {
    const appId = randomUUID(),
      workflowId = randomUUID();
    let graph: unknown;
    let published = false;
    let siteEnabled = true;
    let imports = 0,
      publishes = 0,
      keys = 0;
    const request: typeof difyJson = async (path, config = {}) => {
      if (options.deleted && path.startsWith(`/apps/${appId}`)) {
        assert.equal(
          config.body,
          undefined,
          "Missing apps must be checked before mutation",
        );
        throw new AppError(
          "DIFY_APP_NOT_FOUND",
          "App no longer available",
          404,
        );
      }
      if (path === "/workspaces/current/tools/mcp")
        return options.missing
          ? []
          : [
              {
                id: "workspace_mcp",
                is_team_authorization: true,
                tools: (options.allTools
                  ? [
                      "get_reference_document_v1",
                      "get_demo_catalog_v1",
                      "calculate_demo_quote_v1",
                      "get_run_context_v1",
                      "read_artifact_v1",
                      "save_artifact_draft_v1",
                      "approve_artifact_v1",
                    ]
                  : ["get_reference_document_v1"]
                ).map((name) => ({ name })),
              },
            ];
      if (path === "/apps/imports") {
        imports++;
        if (options.rejected)
          throw new AppError(
            "DIFY_IMPORT_REJECTED",
            "Import permission denied",
            409,
          );
        const body = config.body as { app_id?: string; yaml_content: string };
        assert.equal(body.app_id, undefined);
        graph = JSON.parse(body.yaml_content).workflow.graph;
        if (options.lost) throw new Error("transport lost");
        if (options.revoke)
          await access.updateOne(
            { _id: actor.uid },
            { $set: { role: "member" } },
          );
        return { status: "completed", app_id: appId };
      }
      if (path === `/apps/${appId}/workflows/draft`)
        return { graph: options.changed ? { nodes: [] } : graph };
      if (path === `/apps/${appId}/site-enable`) {
        if (options.siteFail) throw new Error("temporary setting failure");
        assert.deepEqual(config.body, { enable_site: false });
        siteEnabled = false;
        return { enable_site: false };
      }
      if (path === `/apps/${appId}/workflows/publish`) {
        if (config.body !== undefined) {
          publishes++;
          published = true;
          return { result: "success" };
        }
        return published ? { id: workflowId, graph } : null;
      }
      if (path === `/apps/${appId}`)
        return {
          mode: "workflow",
          name: "Unibase starter",
          description: "Demo",
          enable_site: siteEnabled,
        };
      if (path === `/apps/${appId}/api-keys`) {
        if (config.body !== undefined) keys++;
        return config.body === undefined
          ? {
              data: keys
                ? [{ id: randomUUID(), token: "app-fixture-private-canary" }]
                : [],
            }
          : { id: randomUUID(), token: "app-fixture-private-canary" };
      }
      if (path === "/info") {
        if (options.registerFail)
          throw new Error("temporary verification failure");
        return { mode: "workflow" };
      }
      if (path === "/parameters")
        return {
          user_input_form: (
            ((
              graph as ReturnType<
                typeof orchestratorTemplate
              >["dsl"]["workflow"]["graph"]
            ).nodes.find((n) => n.data.type === "start")?.data.variables ??
              []) as { type: string; variable: string }[]
          ).map((f) => ({ [f.type]: { ...f } })),
        };
      throw new Error(`Unexpected path ${path}`);
    };
    return { request, options, counts: () => ({ imports, publishes, keys }) };
  }
  try {
    await t.test("success and repeated key reuse the same app", async () => {
      const f = fixture(),
        key = randomUUID();
      const first = await createDifyOrchestrator(
        key,
        actor,
        db,
        f.request,
        env,
      );
      assert.equal(first.status, "ready");
      const again = await createDifyOrchestrator(
        key,
        actor,
        db,
        f.request,
        env,
      );
      assert.equal(again.appId, first.appId);
      assert.deepEqual(f.counts(), { imports: 1, publishes: 1, keys: 1 });
    });
    await t.test("missing MCP performs no mutation and can retry", async () => {
      const f = fixture({ missing: true }),
        key = randomUUID();
      await assert.rejects(
        createDifyOrchestrator(key, actor, db, f.request, env),
        /Connect Unibase MCP/,
      );
      assert.equal(f.counts().imports, 0);
      f.options.missing = false;
      assert.equal(
        (await createDifyOrchestrator(key, actor, db, f.request, env)).status,
        "ready",
      );
    });
    await t.test(
      "all templates create with their selected MCP tools; a retry cannot change templates",
      async () => {
        for (const template of orchestratorTemplates()) {
          const f = fixture({ allTools: true });
          const key = randomUUID();
          const result = await createDifyOrchestrator(
            key,
            actor,
            db,
            f.request,
            env,
            template.id,
          );
          assert.equal(
            result.status,
            template.id === "case-preparation" ? "setup-required" : "ready",
          );
          await createDifyOrchestrator(
            key,
            actor,
            db,
            f.request,
            env,
            template.id,
          );
          const expected =
            template.id === "case-preparation"
              ? { imports: 1, publishes: 0, keys: 0 }
              : { imports: 1, publishes: 1, keys: 1 };
          assert.deepEqual(f.counts(), expected);
          const different =
            template.id === "document-summary"
              ? "saved-artifact"
              : "document-summary";
          await assert.rejects(
            createDifyOrchestrator(key, actor, db, f.request, env, different),
            /another template/,
          );
          assert.deepEqual(f.counts(), expected);
        }
        const missing = fixture();
        await assert.rejects(
          createDifyOrchestrator(
            randomUUID(),
            actor,
            db,
            missing.request,
            env,
            "saved-artifact",
          ),
          /get_run_context_v1/,
        );
        assert.equal(missing.counts().imports, 0);
      },
    );
    await t.test(
      "destination setup retries preserve the edited draft and never publish or create keys",
      async () => {
        const f = fixture({ allTools: true, siteFail: true }),
          key = randomUUID();
        await assert.rejects(
          createDifyOrchestrator(
            key,
            actor,
            db,
            f.request,
            env,
            "case-preparation",
          ),
        );
        f.options.siteFail = false;
        f.options.changed = true;
        const setup = await createDifyOrchestrator(
          key,
          actor,
          db,
          f.request,
          env,
          "case-preparation",
        );
        assert.equal(setup.status, "setup-required");
        assert.equal("orchestratorId" in setup, false);
        assert.deepEqual(f.counts(), { imports: 1, publishes: 0, keys: 0 });
        assert.equal(
          (
            await createDifyOrchestrator(
              key,
              actor,
              db,
              f.request,
              env,
              "case-preparation",
            )
          ).appId,
          setup.appId,
        );
        assert.deepEqual(f.counts(), { imports: 1, publishes: 0, keys: 0 });
      },
    );
    await t.test(
      "retry of a deleted starter performs no mutation or replacement",
      async () => {
        for (const options of [
          {},
          { registerFail: true },
          { siteFail: true },
        ]) {
          const f = fixture(options);
          const key = randomUUID();
          if (f.options.registerFail || f.options.siteFail)
            await assert.rejects(
              createDifyOrchestrator(key, actor, db, f.request, env),
            );
          else await createDifyOrchestrator(key, actor, db, f.request, env);
          const before = f.counts();
          f.options.deleted = true;
          await assert.rejects(
            createDifyOrchestrator(key, actor, db, f.request, env),
            (error: unknown) =>
              error instanceof AppError &&
              error.code === "DIFY_CREATION_APP_DELETED",
          );
          assert.deepEqual(f.counts(), before);
        }
      },
    );
    await t.test(
      "explicit permission rejection permits retry after correction",
      async () => {
        const f = fixture({ rejected: true }),
          key = randomUUID();
        await assert.rejects(
          createDifyOrchestrator(key, actor, db, f.request, env),
          /permission denied/,
        );
        f.options.rejected = false;
        assert.equal(
          (await createDifyOrchestrator(key, actor, db, f.request, env)).status,
          "ready",
        );
        assert.deepEqual(f.counts(), { imports: 2, publishes: 1, keys: 1 });
      },
    );
    await t.test("lost import response never duplicates the app", async () => {
      const f = fixture({ lost: true }),
        key = randomUUID();
      await assert.rejects(
        createDifyOrchestrator(key, actor, db, f.request, env),
      );
      await assert.rejects(
        createDifyOrchestrator(key, actor, db, f.request, env),
        /did not confirm/,
      );
      assert.equal(f.counts().imports, 1);
    });
    await t.test(
      "verification retry never imports or publishes again",
      async () => {
        const f = fixture({ registerFail: true }),
          key = randomUUID();
        await assert.rejects(
          createDifyOrchestrator(key, actor, db, f.request, env),
        );
        f.options.registerFail = false;
        assert.equal(
          (await createDifyOrchestrator(key, actor, db, f.request, env)).status,
          "ready",
        );
        assert.deepEqual(f.counts(), { imports: 1, publishes: 1, keys: 1 });
      },
    );
    await t.test("changed draft is never published automatically", async () => {
      const f = fixture({ changed: true });
      await assert.rejects(
        createDifyOrchestrator(randomUUID(), actor, db, f.request, env),
        /draft changed/,
      );
      assert.equal(f.counts().publishes, 0);
    });
    await t.test("role revocation stops publication", async () => {
      const f = fixture({ revoke: true });
      await assert.rejects(
        createDifyOrchestrator(randomUUID(), actor, db, f.request, env),
        /Administrator/,
      );
      assert.equal(f.counts().publishes, 0);
      await access.updateOne({ _id: actor.uid }, { $set: { role: "admin" } });
    });
    await t.test("member and stale session cannot import", async () => {
      const f = fixture();
      await assert.rejects(
        createDifyOrchestrator(
          randomUUID(),
          { ...actor, uid: "member" },
          db,
          f.request,
          env,
        ),
        /Administrator/,
      );
      await assert.rejects(
        createDifyOrchestrator(
          randomUUID(),
          { ...actor, auth_time: actor.auth_time - 1801 },
          db,
          f.request,
          env,
        ),
        /sign in again/,
      );
      assert.equal(f.counts().imports, 0);
    });
  } finally {
    await client.close();
    await repl.stop();
  }
});
