import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";
import {
  createCreditIndexes,
  grantCredits,
  readWallet,
} from "../../src/lib/server/store/credits.ts";
import { createAiIndexes } from "../../src/lib/server/ai/jobs.ts";
import {
  existingApp,
  emptyApp,
  existingToken,
  createdToken,
  workflowId,
  previousWorkflowId,
} from "./dify-keys-fixture.mjs";

assert.equal(process.env.DIFY_MODE, "live");
assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
assert.match(process.env.MONGODB_DATABASE, /^unibase_test_[a-f0-9]+$/);
const origin = process.env.APP_ORIGIN;
const auth = getAuth(
  initializeApp({ projectId: "demo-unibase" }, `runs-${randomUUID()}`),
);
const mongo = new MongoClient(process.env.MONGODB_URI);
const db = mongo.db(process.env.MONGODB_DATABASE);
const created = [];
after(async () => {
  await Promise.all(created.map((uid) => auth.deleteUser(uid)));
  await mongo.close();
});
async function browser() {
  const email = `${randomUUID()}@example.test`;
  const user = await auth.createUser({
    email,
    password: "owned-test-password",
    emailVerified: true,
  });
  created.push(user.uid);
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "owned-test-password",
        returnSecureToken: true,
      }),
    },
  );
  assert.equal(response.status, 200);
  const { idToken } = await response.json();
  const jar = new Map();
  let token;
  async function request(path, options = {}) {
    const multipart = options.body instanceof FormData;
    const result = await fetch(`${origin}${path}`, {
      ...options,
      headers: {
        cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
        origin,
        ...(multipart ? {} : { "content-type": "application/json" }),
        ...(token ? { "x-csrf-token": token } : {}),
        ...options.headers,
      },
    });
    for (const cookie of result.headers.getSetCookie()) {
      const first = cookie.split(";")[0];
      const index = first.indexOf("=");
      jar.set(first.slice(0, index), first.slice(index + 1));
    }
    return result;
  }
  token = (await (await request("/api/auth/csrf")).json()).token;
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ idToken }),
      })
    ).status,
    200,
  );
  return { uid: user.uid, request };
}
async function runWorker() {
  const child = spawn(process.execPath, ["dist/ai-worker.cjs", "--once"], {
    env: process.env,
    windowsHide: true,
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
}

test("Read-only registration runs native Dify outputs without graph changes", async () => {
  await createCreditIndexes(db);
  await createAiIndexes(db);
  const owner = await browser();
  const other = await browser();
  await db.collection("accountAccess").updateOne(
    { _id: owner.uid },
    {
      $set: {
        role: "admin",
        status: "active",
        notBefore: 0,
        revision: 0,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  await grantCredits(db, owner.uid, "seed", {
    amount: 30,
    source: "purchase",
    reference: owner.uid,
  });
  const command = (actor, body) =>
    actor.request("/api/admin/orchestrators/manage", {
      method: "POST",
      body: JSON.stringify(body),
    });
  assert.equal(await db.collection("orchestrators").countDocuments(), 0);
  const initial = await command(owner, { action: "discover" });
  assert.equal(initial.status, 200);
  assert.deepEqual(
    (await initial.json()).apps.map((app) => app.status),
    ["unregistered", "unregistered"],
  );
  assert.equal(
    (await command(other, { action: "register", appId: existingApp })).status,
    403,
  );
  assert.equal(
    (await command(other, { action: "versions", appId: existingApp })).status,
    403,
  );
  assert.equal(
    (await command(owner, { action: "versions", appId: existingApp, page: 0 }))
      .status,
    400,
  );
  assert.equal(
    (
      await command(owner, {
        action: "register",
        appId: existingApp,
        definition: {},
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.request("/api/admin/orchestrators", {
        method: "POST",
        body: "{}",
      })
    ).status,
    405,
  );
  for (const appId of [existingApp, emptyApp]) {
    const response = await command(owner, { action: "register", appId });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    assert.ok(!text.includes(existingToken) && !text.includes(createdToken));
    const registered = JSON.parse(text);
    assert.equal(registered.status, "ready");
    assert.equal(
      (await (await command(owner, { action: "status", appId })).json()).status,
      "ready",
    );
    const catalog = await (
      await owner.request("/api/admin/orchestrators")
    ).json();
    const selected = catalog.find(
      (row) => row.id === registered.orchestratorId,
    );
    assert.equal(selected.enabled, true);
    assert.equal(selected.validated, true);
    assert.equal(selected.ready, true);
    assert.deepEqual(
      selected.inputs.map((field) => field.name),
      appId === existingApp ? ["prompt"] : [],
    );
    const body = {
      key: randomUUID(),
      orchestratorId: selected.id,
      configurationKey: selected.configurationKey,
      inputs: appId === existingApp ? { prompt: "Hello first-time setup" } : {},
    };
    assert.equal(
      (
        await owner.request("/api/runs", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            key: randomUUID(),
            inputs: { prompt: "x".repeat(257) },
          }),
        })
      ).status,
      400,
    );
    const admitted = await owner.request("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const admittedText = await admitted.text();
    assert.equal(admitted.status, 202, admittedText);
    const run = JSON.parse(admittedText);
    if (appId === existingApp) {
      const versionResponse = await command(owner, {
        action: "versions",
        appId,
      });
      assert.equal(versionResponse.status, 200);
      const versions = await versionResponse.json();
      assert.deepEqual(
        versions.versions.map((v) => v.id),
        [workflowId, previousWorkflowId],
      );
      assert(!JSON.stringify(versions).includes("graph"));
      const switched = await command(owner, {
        action: "register",
        appId,
        selection: { workflowId: previousWorkflowId, page: 1 },
      });
      assert.equal(switched.status, 200, await switched.clone().text());
      assert.equal((await switched.json()).workflowId, previousWorkflowId);
      assert.equal(
        (await db.collection("aiJobs").findOne({ _id: run.id })).run
          .orchestrator.workflowId,
        workflowId,
      );
    }
    await runWorker();
    if (appId === existingApp) {
      const current = (
        await (await owner.request("/api/admin/orchestrators")).json()
      ).find((row) => row.id === selected.id);
      const nextResponse = await owner.request("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          key: randomUUID(),
          configurationKey: current.configurationKey,
        }),
      });
      assert.equal(nextResponse.status, 202, await nextResponse.clone().text());
      const nextRun = await nextResponse.json();
      assert.equal(
        (await db.collection("aiJobs").findOne({ _id: nextRun.id })).run
          .orchestrator.workflowId,
        previousWorkflowId,
      );
      await runWorker();
      const nextDetail = await (
        await owner.request(`/api/runs/${nextRun.id}`)
      ).json();
      assert.equal(nextDetail.status, "succeeded");
      assert.equal(
        (
          await command(owner, {
            action: "register",
            appId,
            selection: { workflowId, page: 1 },
          })
        ).status,
        200,
      );
    }
    const detailResponse = await owner.request(`/api/runs/${run.id}`);
    const detailText = await detailResponse.text();
    assert.equal(detailResponse.status, 200, detailText);
    assert.ok(
      !detailText.includes(existingToken) && !detailText.includes(createdToken),
    );
    const detail = JSON.parse(detailText);
    assert.equal(detail.status, "succeeded", detailText);
    assert.ok(
      detail.events.some(
        ({ event }) =>
          event.type === "stage" &&
          event.title === "Generate" &&
          event.status === "succeeded",
      ),
      "Owned tracing preserves provider node events",
    );
    assert.equal(
      detail.attempts[0].result.text,
      appId === existingApp
        ? "Result: Hello first-time setup"
        : "Result: Inline workflow prompt",
    );
    const job = await db.collection("aiJobs").findOne({ _id: run.id });
    assert.ok(job.runId && job.taskId, "Dify execution identity is persisted");
    assert.deepEqual(
      Object.keys(job.inputs).sort(),
      appId === existingApp
        ? ["prompt", "unibase_attempt_id", "unibase_run_id"]
        : [],
    );
    assert.equal((await other.request(`/api/runs/${run.id}`)).status, 404);
    assert.equal(
      (
        await owner.request("/api/runs", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).status,
      202,
    );
    await runWorker();
    const before = await db
      .collection("orchestrators")
      .findOne({ _id: selected.id });
    assert.equal(
      (await command(owner, { action: "register", appId })).status,
      200,
    );
    const after = await db
      .collection("orchestrators")
      .findOne({ _id: selected.id });
    assert.equal(after.revision, before.revision);
  }
  assert.equal((await readWallet(db, owner.uid)).balance, 27);
  assert.equal(await db.collection("orchestrators").countDocuments(), 2);
  assert.equal(await db.collection("difyCredentials").countDocuments(), 2);
  const storage =
    JSON.stringify(await db.collection("difyCredentials").find().toArray()) +
    JSON.stringify(
      await db.collection("orchestratorRegistrations").find().toArray(),
    );
  assert.ok(
    !storage.includes(existingToken) && !storage.includes(createdToken),
  );
  const stats = await fetch(`${process.env.DIFY_CONSOLE_URL}/fixture/stats`, {
    headers: {
      authorization: `Bearer ${process.env.DIFY_MANAGEMENT_KEY}`,
      "x-workspace-id": process.env.DIFY_WORKSPACE_ID,
    },
  });
  assert.deepEqual(await stats.json(), {
    creates: 1,
    draftUpdates: 0,
    publishes: 0,
    executions: 3,
  });
  const creationKey = randomUUID();
  assert.equal(
    (await command(other, { action: "create", key: creationKey })).status,
    403,
  );
  const createdResponse = await command(owner, {
    action: "create",
    key: creationKey,
  });
  const createdText = await createdResponse.text();
  assert.equal(createdResponse.status, 200, createdText);
  const starter = JSON.parse(createdText);
  const starterApp = await fetch(
    `${process.env.DIFY_CONSOLE_URL}/apps/${starter.appId}`,
    {
      headers: {
        authorization: `Bearer ${process.env.DIFY_MANAGEMENT_KEY}`,
        "x-workspace-id": process.env.DIFY_WORKSPACE_ID,
      },
    },
  );
  assert.equal(
    (await starterApp.json()).enable_site,
    false,
    "Create disables the public Dify Web App while keeping Human Input API delivery",
  );
  assert.equal(
    (
      await (
        await command(owner, { action: "create", key: creationKey })
      ).json()
    ).appId,
    starter.appId,
  );
  const catalog = await (
    await owner.request("/api/admin/orchestrators")
  ).json();
  const selected = catalog.find((row) => row.id === starter.orchestratorId);
  assert.deepEqual(selected.inputs, []);
  const admitted = await owner.request("/api/runs", {
    method: "POST",
    body: JSON.stringify({
      key: randomUUID(),
      orchestratorId: selected.id,
      configurationKey: selected.configurationKey,
      inputs: {},
    }),
  });
  assert.equal(admitted.status, 202);
  const run = await admitted.json();
  await runWorker();
  const paused = await (await owner.request(`/api/runs/${run.id}`)).json();
  assert.equal(paused.status, "awaiting input", JSON.stringify(paused));
  assert.equal(paused.decisions.length, 1);
  const decision = paused.decisions[0];
  assert.equal(decision.cards[0].content.data.title, "Choose a summary");
  assert.equal(
    (
      await command(owner, {
        action: "disable",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await command(owner, {
        action: "unregister",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    200,
  );
  const answer = {
    key: randomUUID(),
    action: "continue",
    response: { direction: "detailed" },
  };
  assert.equal(
    (
      await other.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify(answer),
      })
    ).status,
    404,
  );
  const submitted = await owner.request(
    `/api/runs/${run.id}/decisions/${decision.id}`,
    { method: "POST", body: JSON.stringify(answer) },
  );
  assert.equal(submitted.status, 200, await submitted.text());
  await db
    .collection("aiJobs")
    .updateOne(
      { _id: run.attemptId },
      { $set: { nextAttemptAt: new Date(0) } },
    );
  await runWorker();
  const completed = await (await owner.request(`/api/runs/${run.id}`)).json();
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.match(
    completed.attempts[0].result.text,
    /MCP document received.*Detailed/s,
  );
  assert.ok(
    completed.events.some(
      ({ event }) =>
        event.type === "stage" &&
        event.title === "Fetch demo document through MCP" &&
        event.status === "succeeded",
    ),
  );
  assert.ok(
    completed.events.some(
      ({ event }) =>
        event.type === "stage" &&
        event.title === "Compose result" &&
        event.status === "succeeded",
    ),
  );
  // The accepted paused Run continued using its snapshot after both actions.
  assert.equal(
    (await command(owner, { action: "register", appId: starter.appId })).status,
    200,
  );
  const finalStats = await fetch(
    `${process.env.DIFY_CONSOLE_URL}/fixture/stats`,
    {
      headers: {
        authorization: `Bearer ${process.env.DIFY_MANAGEMENT_KEY}`,
        "x-workspace-id": process.env.DIFY_WORKSPACE_ID,
      },
    },
  );
  assert.deepEqual(await finalStats.json(), {
    creates: 2,
    draftUpdates: 0,
    publishes: 1,
    executions: 4,
    imports: 1,
    mcpCalls: 1,
  });
  const balance = (await readWallet(db, owner.uid)).balance;
  const jobCount = await db.collection("aiJobs").countDocuments();
  assert.equal(
    (
      await command(other, {
        action: "disable",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await command(owner, {
        action: "disable",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await command(owner, { action: "discover" })).json()).apps.find(
      (a) => a.id === starter.appId,
    ).status,
    "disabled",
  );
  const startAgain = () =>
    owner.request("/api/runs", {
      method: "POST",
      body: JSON.stringify({
        key: randomUUID(),
        orchestratorId: selected.id,
        configurationKey: selected.configurationKey,
        inputs: {},
      }),
    });
  assert.equal((await startAgain()).status, 409);
  assert.equal(
    (await (await owner.request(`/api/runs/${run.id}`)).json()).status,
    "succeeded",
  );
  assert.equal(
    (await command(owner, { action: "register", appId: starter.appId })).status,
    200,
  );
  const credentials = await db.collection("difyCredentials").countDocuments();
  assert.equal(
    (
      await command(owner, {
        action: "unregister",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    200,
  );
  assert.equal((await startAgain()).status, 409);
  assert.equal(
    (await (await command(owner, { action: "discover" })).json()).apps.find(
      (a) => a.id === starter.appId,
    ).registered,
    false,
  );
  assert.equal(
    await db.collection("difyCredentials").countDocuments(),
    credentials,
  );
  assert.equal(
    (await (await owner.request(`/api/runs/${run.id}`)).json()).status,
    "succeeded",
  );
  assert.equal(
    (await command(owner, { action: "register", appId: starter.appId })).status,
    200,
  );
  const removed = await fetch(
    `${process.env.DIFY_CONSOLE_URL}/fixture/remove`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.DIFY_MANAGEMENT_KEY}`,
        "x-workspace-id": process.env.DIFY_WORKSPACE_ID,
        "content-type": "application/json",
      },
      body: JSON.stringify({ appId: starter.appId }),
    },
  );
  assert.equal(removed.status, 200);
  // A stale user page is rejected before reserving credit, even before Admin refresh.
  assert.equal((await startAgain()).status, 409);
  const missing = (
    await (await command(owner, { action: "discover" })).json()
  ).apps.find((a) => a.id === starter.appId);
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.available, false);
  assert.equal(missing.registered, true);
  assert.equal(
    (await (await owner.request("/api/admin/orchestrators")).json()).find(
      (a) => a.id === starter.orchestratorId,
    ).ready,
    false,
  );
  assert.equal(
    (await (await owner.request(`/api/runs/${run.id}`)).json()).attempts[0]
      .result.text,
    completed.attempts[0].result.text,
  );
  assert.equal(
    (
      await command(owner, {
        action: "unregister",
        orchestratorId: starter.orchestratorId,
      })
    ).status,
    200,
  );
  assert.ok(
    !(await (await command(owner, { action: "discover" })).json()).apps.some(
      (a) => a.id === starter.appId,
    ),
  );
  assert.equal((await readWallet(db, owner.uid)).balance, balance);
  assert.equal(await db.collection("aiJobs").countDocuments(), jobCount);
  assert.equal(
    (
      await command(owner, {
        action: "create",
        key: randomUUID(),
        templateId: "../secret",
      })
    ).status,
    400,
  );
  for (const templateId of ["catalog-picker", "quote-approval"]) {
    assert.equal(
      (
        await command(owner, {
          action: "create",
          key: randomUUID(),
          templateId,
        })
      ).status,
      400,
    );
  }
  const setupKey = randomUUID();
  const createCase = () =>
    command(owner, {
      action: "create",
      key: setupKey,
      templateId: "case-preparation",
    });
  const setupResponse = await createCase();
  const setup = await setupResponse.json();
  assert.equal(setupResponse.status, 200, JSON.stringify(setup));
  assert.equal(setup.status, "setup-required");
  assert.equal(setup.name, "Case preparation");
  assert.equal((await (await createCase()).json()).appId, setup.appId);
  assert.equal(
    await db
      .collection("orchestrators")
      .countDocuments({ "definition.appId": setup.appId }),
    0,
  );
  const caseApp = (
    await (await command(owner, { action: "discover" })).json()
  ).apps.find((a) => a.id === setup.appId);
  assert.equal(caseApp.registered, false);
  assert.equal(caseApp.status, "unregistered");
});
