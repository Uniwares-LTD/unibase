import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { MongoClient, type Document } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { AppError } from "../../src/lib/auth-policy";
import {
  changeOrchestrator,
  difyAppCatalog,
  verifyOrchestratorAvailable,
  guardOrchestratorAdmission,
  reconcileOrchestratorAvailability,
} from "../../src/lib/server/runs/orchestrator-lifecycle";
import {
  registerDifyOrchestrator,
  discoverDifyOrchestrators,
  registrationStatus,
} from "../../src/lib/server/runs/registration";
import type { OrchestratorRecord } from "../../src/lib/server/runs/orchestrators";
import type { difyJson } from "../../src/lib/server/runs/dify-console-client";
import { readReports } from "../../src/lib/server/store/reports";
import {
  bindingTestEnvironment,
  mockBindingProbe,
  environmentRequest,
  ownFixtureApp,
} from "./fixtures/environment-binding";

test("Orchestrator lifecycle: deletion, outages, disable, unregister and registration fencing", async (t) => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri()),
    db = client.db("lifecycle");
  const actor = { uid: "admin", auth_time: Math.floor(Date.now() / 1000) };
  await db.collection<Document & { _id: string }>("accountAccess").insertOne({
    _id: actor.uid,
    role: "admin",
    status: "active",
    notBefore: 0,
  });
  const env = {
    ...bindingTestEnvironment,
    DIFY_MODE: "live",
    DIFY_BASE_URL: "https://dify.test/v1",
    DIFY_CONSOLE_URL: "https://dify.test/console/api",
    DIFY_MANAGEMENT_KEY: "private-management",
    DIFY_WORKSPACE_ID: randomUUID(),
  };
  const apps = new Map<string, { name: string; workflowId: string }>();
  let outage = false;
  let pause: (() => Promise<void>) | undefined;
  mockBindingProbe(t, env);
  const rawRequest: typeof difyJson = async (path, config = {}) => {
    if (outage)
      throw new AppError("DIFY_REJECTED", "Provider unavailable", 502);
    if (path.startsWith("/apps?"))
      return {
        data: [...apps].map(([id, a]) => ({
          id,
          name: a.name,
          mode: "workflow",
        })),
        has_more: false,
      };
    if (path === "/info") return { mode: "workflow" };
    if (path === "/parameters") return { user_input_form: [] };
    if (path === "/workspaces/current/tools/mcp")
      return [{ id: "fixture", is_team_authorization: true, tools: [] }];
    const match = /^\/apps\/([a-f0-9-]+)(.*)$/.exec(path);
    if (!match) throw Error(`Unexpected ${path}`);
    const app = apps.get(match[1]);
    if (!app) throw new AppError("DIFY_APP_NOT_FOUND", "App unavailable", 404);
    if (!match[2])
      return { mode: "workflow", name: app.name, description: "Example" };
    if (match[2] === "/workflows/publish" || match[2] === "/workflows/draft") {
      assert.equal(config.body, undefined);
      await pause?.();
      return {
        id: app.workflowId,
        graph: {
          nodes: [
            { id: "start", data: { type: "start", variables: [] } },
            { id: "end", data: { type: "end", outputs: [] } },
          ],
        },
      };
    }
    if (match[2] === "/api-keys") {
      assert.equal(config.body, undefined, "Existing key must be reused");
      return {
        data: [{ id: match[1], token: "app-lifecycle-private-key" }],
      };
    }
    throw Error(`Unexpected ${path}`);
  };
  const request = environmentRequest(db, env, rawRequest);
  const records = db.collection<OrchestratorRecord>("orchestrators");
  async function registered() {
    const appId = randomUUID();
    apps.set(appId, { name: "Lifecycle workflow", workflowId: randomUUID() });
    await ownFixtureApp(appId, db, env);
    const result = await registerDifyOrchestrator(
      appId,
      actor,
      db,
      request,
      env,
    );
    return (await records.findOne({ _id: result.orchestratorId }))!;
  }
  try {
    await t.test(
      "Disable and Unregister keep records, credentials and history; Register re-enables",
      async () => {
        const record = await registered(),
          appId = record.definition.appId!;
        await db
          .collection("runResults")
          .insertOne({ logicalId: "owned-history", result: { text: "Saved" } });
        await db.collection("aiJobs").insertOne({
          run: { orchestrator: record.definition },
          uid: "owner",
        });
        const credentials = await db
          .collection("difyCredentials")
          .countDocuments();
        assert.equal(
          (await changeOrchestrator("disable", record._id, actor, db)).status,
          "disabled",
        );
        assert.equal(
          (await registrationStatus(appId, db, env)).status,
          "disabled",
        );
        const disabled = (await records.findOne({ _id: record._id }))!;
        assert.equal(disabled.definition.enabled, false);
        await changeOrchestrator("disable", record._id, actor, db);
        assert.equal(
          (await records.findOne({ _id: record._id }))!.revision,
          disabled.revision,
        );
        const row = (
          await discoverDifyOrchestrators(db, request, env)
        ).apps.find((a) => a.id === appId)!;
        assert.equal(row.registered, true);
        assert.equal(row.status, "disabled");
        await registerDifyOrchestrator(appId, actor, db, request, env);
        assert.equal(
          (await records.findOne({ _id: record._id }))!.definition.enabled,
          true,
        );
        await changeOrchestrator("unregister", record._id, actor, db);
        assert.equal(
          (await registrationStatus(appId, db, env)).status,
          "unregistered",
        );
        assert.equal(
          (await discoverDifyOrchestrators(db, request, env)).apps.find(
            (a) => a.id === appId,
          )!.registered,
          false,
        );
        assert.equal(
          await db.collection("difyCredentials").countDocuments(),
          credentials,
        );
        assert.equal(await db.collection("runResults").countDocuments(), 1);
        assert.equal(await db.collection("aiJobs").countDocuments(), 1);
        const report = await readReports(
          db,
          { uid: actor.uid, authTime: actor.auth_time },
          { kind: "audit" },
        );
        assert.ok(
          report.rows.every((row) => typeof row.id === "string"),
          "Audit rows must serialize as plain string IDs for Admin reports",
        );
        await registerDifyOrchestrator(appId, actor, db, request, env);
        assert.equal(
          (await records.findOne({ _id: record._id }))!.lifecycle,
          undefined,
        );
      },
    );
    await t.test(
      "Deleted app stays visible to admin and cannot pass fresh admission",
      async () => {
        const record = await registered();
        const original = apps.get(record.definition.appId!)!;
        apps.delete(record.definition.appId!);
        await assert.rejects(
          verifyOrchestratorAvailable(record, db, request, env),
          /no longer available/,
        );
        const catalog = await discoverDifyOrchestrators(db, request, env);
        const row = catalog.apps.find((a) => a.orchestratorId === record._id)!;
        assert.equal(row.status, "unavailable");
        assert.equal(row.available, false);
        assert.equal(row.registered, true);
        apps.set(record.definition.appId!, original);
        await registerDifyOrchestrator(
          record.definition.appId!,
          actor,
          db,
          request,
          env,
        );
        assert.equal(
          (await records.findOne({ _id: record._id }))!.availability,
          undefined,
        );
        apps.delete(record.definition.appId!);
        await changeOrchestrator("unregister", record._id, actor, db);
        assert.ok(
          !(await discoverDifyOrchestrators(db, request, env)).apps.some(
            (a) => a.id === record.definition.appId,
          ),
        );
      },
    );
    await t.test(
      "Outage and incomplete catalog never mark a workflow deleted",
      async () => {
        const record = await registered();
        await reconcileOrchestratorAvailability(
          [],
          db,
          new Date(Date.now() - 1000),
        );
        assert.equal(
          (await records.findOne({ _id: record._id }))!.availability,
          undefined,
          "A stale catalog cannot invalidate a newer registration",
        );
        outage = true;
        await assert.rejects(
          verifyOrchestratorAvailable(record, db, request, env),
          /Could not verify/,
        );
        const catalog = await discoverDifyOrchestrators(db, request, env);
        assert.ok(catalog.warning);
        assert.ok(catalog.apps.some((a) => a.orchestratorId === record._id));
        assert.equal(
          (await records.findOne({ _id: record._id }))!.availability,
          undefined,
        );
        outage = false;
        const incomplete: typeof difyJson = async () => ({
          data: [],
          has_more: true,
        });
        await assert.rejects(difyAppCatalog(incomplete), /incomplete/);
        assert.ok(
          (await discoverDifyOrchestrators(db, incomplete, env)).warning,
        );
        assert.equal(
          (await records.findOne({ _id: record._id }))!.availability,
          undefined,
        );
      },
    );
    await t.test(
      "Disable fences concurrent registration and admission uses the current revision",
      async () => {
        const record = await registered();
        let release!: () => void, entered!: () => void;
        const blocked = new Promise<void>((r) => (release = r)),
          started = new Promise<void>((r) => (entered = r));
        pause = async () => {
          entered();
          await blocked;
        };
        const registering = registerDifyOrchestrator(
          record.definition.appId!,
          actor,
          db,
          request,
          env,
        );
        await started;
        await changeOrchestrator("disable", record._id, actor, db);
        release();
        await assert.rejects(registering, /changed|stopped/);
        pause = undefined;
        assert.equal(
          (await records.findOne({ _id: record._id }))!.definition.enabled,
          false,
        );
        const session = client.startSession();
        try {
          await assert.rejects(
            session.withTransaction(() =>
              guardOrchestratorAdmission(db, record, session),
            ),
            /changed or was disabled/,
          );
        } finally {
          await session.endSession();
        }
      },
    );
    await t.test(
      "Older valid admin sessions can change registrations; members and revoked sessions cannot",
      async () => {
        const record = await registered();
        await assert.rejects(
          changeOrchestrator(
            "unregister",
            record._id,
            { ...actor, uid: "member" },
            db,
          ),
          /Administrator/,
        );
        const older = { ...actor, auth_time: actor.auth_time - 3600 };
        await changeOrchestrator("disable", record._id, older, db);
        assert.equal(
          (await records.findOne({ _id: record._id }))!.definition.enabled,
          false,
        );
        await db
          .collection<Document & { _id: string }>("accountAccess")
          .updateOne(
            { _id: actor.uid },
            { $set: { notBefore: older.auth_time + 1 } },
          );
        await assert.rejects(
          changeOrchestrator("unregister", record._id, older, db),
          /Administrator/,
        );
        assert.notEqual(
          (await records.findOne({ _id: record._id }))!.lifecycle,
          "unregistered",
        );
      },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
