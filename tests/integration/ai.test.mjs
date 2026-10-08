import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID, randomBytes } from "node:crypto";
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
  appointFirstAdmin,
  changeAccess,
} from "../../src/lib/server/store/access.ts";

assert.equal(process.env.DIFY_MODE, "fake");
assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
assert.match(process.env.MONGODB_DATABASE, /^unitale_test_[a-f0-9]+$/);
const pricingMode = Boolean(process.env.AI_PRICING_JSON);
const origin = process.env.APP_ORIGIN;
const auth = getAuth(
  initializeApp({ projectId: "demo-unitale" }, `ai-${randomUUID()}`),
);
const mongo = new MongoClient(process.env.MONGODB_URI);
const db = mongo.db(process.env.MONGODB_DATABASE);
const created = [];
after(async () => {
  await Promise.all(created.map((uid) => auth.deleteUser(uid)));
  await mongo.close();
});

test("admin operations require authorization, CSRF and confirmation; cleanup preserves billing", async () => {
  const admin = await browser();
  const member = await browser();
  await db.collection("accountAccess").updateOne(
    { _id: admin.uid },
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
  const { createAiJob, aiJobs } =
    await import("../../src/lib/server/ai/jobs.ts");
  const profilePath = "/api/admin/execution-profiles";
  assert.equal((await member.request(profilePath)).status, 403);
  assert.equal((await admin.request("/admin/execution-profiles")).status, 200);
  const profileRequest = {
    key: randomUUID(),
    id: randomUUID(),
    revision: 0,
    expectedUid: admin.uid,
    reason: "HTTP execution profile fixture",
    definition: {
      name: "HTTP profile",
      description: "Reusable instructions",
      capability: "workspace-compose",
      binding: "compose-alias",
      instructions: "س".repeat(6000),
      includeConversation: true,
      includeDecisions: true,
      requiresSource: false,
      audience: "everyone",
      enabled: true,
    },
  };
  assert.equal(
    (
      await admin.request(profilePath, {
        method: "POST",
        body: JSON.stringify(profileRequest),
        headers: { "x-csrf-token": "invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await member.request(profilePath, {
        method: "POST",
        body: JSON.stringify({ ...profileRequest, expectedUid: member.uid }),
      })
    ).status,
    403,
  );
  const published = await admin.request(profilePath, {
    method: "POST",
    body: JSON.stringify(profileRequest),
  });
  assert.equal(published.status, 200);
  assert.equal((await published.json()).revision, 1);
  const repeated = await admin.request(profilePath, {
    method: "POST",
    body: JSON.stringify(profileRequest),
  });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).revision, 1);
  assert.equal(
    (await member.request(`${profilePath}/${profileRequest.id}/history`))
      .status,
    403,
  );
  const profileHistory = await admin.request(
    `${profilePath}/${profileRequest.id}/history`,
  );
  assert.equal((await profileHistory.json()).versions.length, 1);
  assert.equal(
    (
      await admin.request(profilePath, {
        method: "POST",
        body: JSON.stringify({ ...profileRequest, key: randomUUID() }),
      })
    ).status,
    409,
  );
  const old = new Date(Date.now() - 90 * 86400000);
  const job = await createAiJob(
    db,
    { uid: member.uid, authTime: 1 },
    randomUUID(),
    {
      capability: "assistant-text",
      capabilityVersion: "1",
      binding: {
        name: "assistant-text",
        kind: "workflow",
        mode: "fake",
        revision: "1",
        fingerprint: "cleanup-fixture",
      },
      inputs: { prompt: "cleanup private fixture" },
      source: null,
      credits: 0,
    },
    old,
  );
  await aiJobs(db).updateOne({ _id: job._id }, { $set: { status: "failed" } });
  const previewPath = "/api/admin/operations/cleanup/preview";
  const body = JSON.stringify({ olderThanDays: 30, scope: "jobs", limit: 100 });
  assert.equal(
    (await member.request(previewPath, { method: "POST", body })).status,
    403,
  );
  assert.equal(
    (
      await admin.request(previewPath, {
        method: "POST",
        body,
        headers: { "x-csrf-token": "invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await admin.request(previewPath, {
        method: "POST",
        body,
        headers: { origin: "https://foreign.test" },
      })
    ).status,
    403,
  );
  const previewResponse = await admin.request(previewPath, {
    method: "POST",
    body,
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.ok(preview.ids.includes(`job:${job._id}`));
  assert.equal(
    (await aiJobs(db).findOne({ _id: job._id })).inputs.prompt,
    "cleanup private fixture",
  );
  const execution = {
    reportId: preview.id,
    reason: "HTTP cleanup verification",
  };
  assert.equal(
    (
      await admin.request("/api/admin/operations/cleanup/execute", {
        method: "POST",
        body: JSON.stringify(execution),
      })
    ).status,
    400,
  );
  const result = await admin.request("/api/admin/operations/cleanup/execute", {
    method: "POST",
    body: JSON.stringify({ ...execution, confirm: true }),
  });
  assert.equal(result.status, 200);
  assert.ok((await result.json()).changed >= 1);
  const retained = await aiJobs(db).findOne({ _id: job._id });
  assert.deepEqual(retained.inputs, {});
  assert.equal(retained.fingerprint, job.fingerprint);
  assert.equal((await admin.request("/admin/operations")).status, 200);
  assert.equal((await member.request("/ai/history")).status, 200);
  const payment = {
    key: randomUUID(),
    orderId: "a".repeat(64),
    reason: "Permission boundary fixture",
  };
  assert.equal(
    (
      await member.request("/api/admin/operations/payments", {
        method: "POST",
        body: JSON.stringify(payment),
      })
    ).status,
    403,
  );
  await db
    .collection("accountAccess")
    .updateOne({ _id: admin.uid }, { $set: { role: "member" } });
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

test("export HTTP: owned version-pinned ZIP and PDF run on the maintenance worker with AI and payments disabled", async () => {
  const { unzipSync, strFromU8 } = await import("fflate");
  const owner = await browser(),
    other = await browser();
  let response = await owner.request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({
      key: randomUUID(),
      expectedUid: owner.uid,
      title: "Export HTTP",
    }),
  });
  assert.equal(response.status, 201);
  let workspace = await response.json();
  const path = `/api/workspaces/${workspace.id}`;
  response = await owner.request(path, {
    method: "POST",
    body: JSON.stringify({
      key: randomUUID(),
      expectedUid: owner.uid,
      revision: workspace.revision,
      action: "save",
      artifactId: null,
      title: "Export original",
      body: "Frozen original content",
      dependencies: [],
    }),
  });
  assert.equal(response.status, 200);
  workspace = await response.json();
  const input = {
    key: randomUUID(),
    expectedUid: owner.uid,
    revision: workspace.revision,
    format: "zip",
    renderer: { type: "archive", version: 1 },
    sources: [{ artifactId: workspace.artifacts[0].id, version: 1 }],
  };
  assert.equal(
    (
      await owner.request(`${path}/exports`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "x-csrf-token": "invalid" },
      })
    ).status,
    403,
  );
  assert.equal((await other.request(`${path}/exports`)).status, 404);
  response = await owner.request(`${path}/exports`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal("snapshot" in job, false);
  assert.equal(
    (
      await (
        await owner.request(`${path}/exports`, {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).json()
    ).id,
    job.id,
  );
  response = await owner.request(path, {
    method: "POST",
    body: JSON.stringify({
      key: randomUUID(),
      expectedUid: owner.uid,
      revision: workspace.revision,
      action: "save",
      artifactId: workspace.artifacts[0].id,
      title: "Changed",
      body: "Later edit",
      dependencies: [],
    }),
  });
  assert.equal(response.status, 200);
  const child = spawn(process.execPath, ["dist/payment-worker.cjs", "--once"], {
    env: { ...process.env, DIFY_MODE: "disabled", PAYMENTS_MODE: "disabled" },
    windowsHide: true,
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
  const jobs = await (await owner.request(`${path}/exports`)).json();
  const finished = jobs.jobs.find((item) => item.id === job.id);
  assert.equal(finished.status, "succeeded", JSON.stringify(finished));
  const downloadPath = `/api/workspace-assets/${finished.assetId}?download`;
  assert.equal((await other.request(downloadPath)).status, 404);
  const download = await owner.request(downloadPath);
  assert.equal(download.headers.get("content-type"), "application/zip");
  assert.match(download.headers.get("cache-control"), /no-store/);
  const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
  assert.equal(
    JSON.parse(strFromU8(files["manifest.json"])).artifacts[0].version.body,
    "Frozen original content",
  );
  workspace = await (await owner.request(path)).json();
  response = await owner.request(`${path}/exports`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      key: randomUUID(),
      revision: workspace.revision,
      format: "pdf",
      renderer: { type: "document", version: 1 },
    }),
  });
  assert.equal(response.status, 202);
  const pdfJob = await response.json();
  const pdfWorker = spawn(
    process.execPath,
    ["dist/payment-worker.cjs", "--once"],
    {
      env: { ...process.env, DIFY_MODE: "disabled", PAYMENTS_MODE: "disabled" },
      windowsHide: true,
      stdio: "inherit",
    },
  );
  assert.equal((await once(pdfWorker, "exit"))[0], 0);
  const pdfJobs = await (await owner.request(`${path}/exports`)).json();
  const pdfFinished = pdfJobs.jobs.find((item) => item.id === pdfJob.id);
  assert.equal(pdfFinished.status, "succeeded", JSON.stringify(pdfFinished));
  const pdfPath = `/api/workspace-assets/${pdfFinished.assetId}?download`;
  assert.equal((await other.request(pdfPath)).status, 404);
  const pdfDownload = await owner.request(pdfPath);
  assert.equal(pdfDownload.headers.get("content-type"), "application/pdf");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(await pdfDownload.arrayBuffer());
  assert.equal(pdf.getTitle(), "Export HTTP");
  assert.equal(pdf.getPageCount(), 1);
  workspace = await (await owner.request(path)).json();
  const cancelledRequest = {
    ...input,
    key: randomUUID(),
    revision: workspace.revision,
  };
  const queued = await (
    await owner.request(`${path}/exports`, {
      method: "POST",
      body: JSON.stringify(cancelledRequest),
    })
  ).json();
  const cancelPath = `${path}/exports/${queued.id}/cancel`;
  assert.equal(
    (
      await other.request(cancelPath, {
        method: "POST",
        body: JSON.stringify({
          expectedUid: other.uid,
          revision: queued.revision,
        }),
      })
    ).status,
    404,
  );
  response = await owner.request(cancelPath, {
    method: "POST",
    body: JSON.stringify({ expectedUid: owner.uid, revision: queued.revision }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "cancelled");
  assert.equal(
    await db.collection("aiJobs").countDocuments({ uid: owner.uid }),
    0,
  );
  assert.equal(
    await db
      .collection("creditReservations")
      .countDocuments({ uid: owner.uid }),
    0,
  );
});

test(
  "workflow and repair HTTP: owned restart-safe execution, controls, findings and checkpoints",
  { skip: pricingMode },
  async () => {
    const { workflowTemplates } =
      await import("../../src/lib/creation/workflows.ts");
    const { fingerprint } = await import("../../src/lib/server/ai/jobs.ts");
    const { createWorkflowIndexes } =
      await import("../../src/lib/server/workspaces/workflows.ts");
    await createWorkflowIndexes(db);
    const owner = await browser(),
      other = await browser();
    await grantCredits(db, owner.uid, "workflow-http", {
      amount: 20,
      source: "purchase",
      reference: owner.uid,
    });
    let workspace = await (
      await owner.request("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          expectedUid: owner.uid,
          title: "Workflow HTTP fixture",
        }),
      })
    ).json();
    const path = `/api/workspaces/${workspace.id}`;
    const input = {
      key: randomUUID(),
      expectedUid: owner.uid,
      revision: workspace.revision,
      definition: workflowTemplates.get("draft-review", 1).definition,
      prompt: "Write a useful guide",
      sources: [],
      targetId: null,
      pricingKeys: {
        "workspace-compose": fingerprint({ mode: "fixed", credits: 1 }),
        "workspace-review": fingerprint({ mode: "fixed", credits: 1 }),
      },
      maximumCredits: 2,
    };
    assert.equal(
      (
        await owner.request(`${path}/workflows`, {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "x-csrf-token": "invalid" },
        })
      ).status,
      403,
    );
    assert.equal((await other.request(`${path}/workflows`)).status, 404);
    assert.equal(
      (
        await other.request(`${path}/workflows`, {
          method: "POST",
          body: JSON.stringify({ ...input, expectedUid: other.uid }),
        })
      ).status,
      404,
    );
    const started = await owner.request(`${path}/workflows`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    assert.equal(started.status, 200);
    let run = await started.json();
    assert.equal(run.lease, undefined);
    assert.equal(run.prompt, undefined);
    assert.equal(run.uid, undefined);
    assert.equal(
      (
        await (
          await owner.request(`${path}/workflows`, {
            method: "POST",
            body: JSON.stringify(input),
          })
        ).json()
      ).id,
      run.id,
    );
    async function control(action, stepId) {
      run = (await (await owner.request(`${path}/workflows`)).json()).find(
        (item) => item.id === run.id,
      );
      const response = await owner.request(`${path}/workflows/${run.id}`, {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          expectedUid: owner.uid,
          revision: run.revision,
          action,
          ...(stepId ? { stepId } : {}),
        }),
      });
      return response;
    }
    assert.equal((await control("pause")).status, 200);
    await runWorker();
    assert.equal(
      await db.collection("aiJobs").countDocuments({ uid: owner.uid }),
      0,
    );
    assert.equal((await control("resume")).status, 200);
    async function reachCheckpoint(id) {
      for (let cycle = 0; cycle < 20; cycle++) {
        await db
          .collection("workspaceWorkflows")
          .updateOne(
            { _id: id, uid: owner.uid },
            { $set: { nextAt: new Date(0) } },
          );
        await runWorker();
        const current = (
          await (await owner.request(`${path}/workflows`)).json()
        ).find((item) => item.id === id);
        if (current.steps.at(-1).status === "awaiting-human") return current;
        assert.ok(
          !current.steps.some((step) => step.status === "blocked"),
          JSON.stringify(current),
        );
      }
      assert.fail("Workflow did not reach its checkpoint");
    }
    run = await reachCheckpoint(run.id);
    assert.equal((await control("checkpoint", "approval")).status, 409);
    workspace = await (await owner.request(path)).json();
    assert.equal(workspace.qualityIssues.length, 1);
    const issue = workspace.qualityIssues[0];
    const repair = {
      key: randomUUID(),
      expectedUid: owner.uid,
      revision: workspace.revision,
      artifactId: issue.artifactId,
      issueIds: [issue.id],
      instructions: "Use clear language",
      composeProfile: null,
      reviewProfile: null,
      composePricingKey: input.pricingKeys["workspace-compose"],
      reviewPricingKey: input.pricingKeys["workspace-review"],
      maximumCredits: 2,
    };
    assert.equal(
      (
        await other.request(`${path}/repairs`, {
          method: "POST",
          body: JSON.stringify({ ...repair, expectedUid: other.uid }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await owner.request(`${path}/repairs`, {
          method: "POST",
          body: JSON.stringify(repair),
          headers: { "x-csrf-token": "invalid" },
        })
      ).status,
      403,
    );
    const repaired = await owner.request(`${path}/repairs`, {
      method: "POST",
      body: JSON.stringify(repair),
    });
    assert.equal(repaired.status, 200);
    const repairRun = await repaired.json();
    assert.equal(
      (
        await (
          await owner.request(`${path}/repairs`, {
            method: "POST",
            body: JSON.stringify(repair),
          })
        ).json()
      ).id,
      repairRun.id,
    );
    await reachCheckpoint(repairRun.id);
    workspace = await (await owner.request(path)).json();
    assert.equal(workspace.artifacts[0].versions.length, 2);
    assert.equal(
      workspace.qualityIssues.find((item) => item.id === issue.id).status,
      "open",
    );
    const resolution = await owner.request(path, {
      method: "POST",
      body: JSON.stringify({
        key: randomUUID(),
        expectedUid: owner.uid,
        revision: workspace.revision,
        action: "quality-issue",
        issueId: issue.id,
        resolution: "resolve",
        reason: "Verified the repaired version against the fresh review.",
      }),
    });
    assert.equal(resolution.status, 200);
    workspace = await resolution.json();
    assert.equal(
      workspace.qualityIssues.find((item) => item.id === issue.id).status,
      "resolved",
    );
    const approval = await owner.request(path, {
      method: "POST",
      body: JSON.stringify({
        key: randomUUID(),
        expectedUid: owner.uid,
        revision: workspace.revision,
        action: "approve",
        artifactId: issue.artifactId,
        version: 2,
        reason: "Reviewed the repaired content.",
      }),
    });
    assert.equal(approval.status, 200);
    run = repairRun;
    assert.equal((await control("checkpoint", "approval")).status, 200);
    await db
      .collection("workspaceWorkflows")
      .updateOne(
        { _id: run.id, uid: owner.uid },
        { $set: { nextAt: new Date(0) } },
      );
    await runWorker();
    assert.equal(
      (await db.collection("workspaceWorkflows").findOne({ _id: run.id }))
        .status,
      "completed",
    );
    assert.equal(
      await db.collection("aiJobs").countDocuments({ uid: owner.uid }),
      4,
    );
    assert.equal((await readWallet(db, owner.uid)).balance, 16);
  },
);

test("creation workspace HTTP: CSRF, ownership, generated decisions, export and private download", async () => {
  const { fingerprint } = await import("../../src/lib/server/ai/jobs.ts");
  const owner = await browser();
  const other = await browser();
  await grantCredits(db, owner.uid, "workspace-http", {
    amount: 10,
    source: "purchase",
    reference: owner.uid,
  });
  const creation = {
    key: randomUUID(),
    title: "HTTP creation workspace",
    expectedUid: owner.uid,
  };
  assert.equal(
    (
      await owner.request("/api/workspaces", {
        method: "POST",
        body: JSON.stringify(creation),
        headers: { "x-csrf-token": "invalid" },
      })
    ).status,
    403,
  );
  const response = await owner.request("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(creation),
  });
  assert.equal(response.status, 201);
  let workspace = await response.json();
  const path = `/api/workspaces/${workspace.id}`;
  assert.equal((await other.request(path)).status, 404);
  assert.equal((await other.request(`${path}/history`)).status, 404);
  assert.equal(
    (await owner.request(`${path}/history?cursor=invalid`)).status,
    400,
  );
  assert.equal(
    (await owner.request(`/workspaces/${workspace.id}`)).status,
    200,
  );
  async function change(action) {
    const result = await owner.request(path, {
      method: "POST",
      body: JSON.stringify({
        ...action,
        key: randomUUID(),
        expectedUid: owner.uid,
        revision: workspace.revision,
      }),
    });
    const data = await result.json();
    assert.equal(result.status, 200, JSON.stringify(data));
    workspace = data;
  }
  await change({ action: "message", text: "A persisted conversation message" });
  const history = await owner.request(`${path}/history`);
  assert.equal(history.status, 200);
  assert.match(history.headers.get("cache-control"), /no-store/);
  assert.equal(
    (await history.json()).entries[0].parts[0].text,
    "A persisted conversation message",
  );
  await change({
    action: "batch",
    capability: "workspace-compose",
    prompt: "Ask a question",
    count: 1,
    targetId: null,
    dependencies: [],
    pricingKey: fingerprint({ mode: "fixed", credits: 1 }),
  });
  assert.equal("requests" in workspace.batches[0], false);
  await runWorker();
  await change({
    action: "select",
    batchId: workspace.batches[0].id,
    index: 0,
  });
  assert.equal(workspace.cards[0].question.kind, "single");
  await change({
    action: "answer",
    cardId: workspace.cards[0].id,
    value: "concise",
  });
  await change({
    action: "save",
    artifactId: null,
    title: "Owned draft",
    body: "Private contents",
    dependencies: [],
  });
  await change({
    action: "export",
    artifactId: workspace.artifacts[0].id,
    version: 1,
    format: "json",
  });
  const download = `/api/workspace-assets/${workspace.assets[0].id}?download`;
  assert.equal((await other.request(download)).status, 404);
  const file = await owner.request(download);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.match(file.headers.get("content-disposition"), /^attachment/);
  assert.equal((await file.json()).version.body, "Private contents");
  await change({
    action: "batch",
    capability: "workspace-image",
    prompt: "A small image",
    count: 1,
    targetId: null,
    dependencies: [],
    pricingKey: fingerprint({ mode: "fixed", credits: 1 }),
  });
  await runWorker();
  const previewPath = `${path}/candidates/${workspace.batches[1].items[0].jobId}/image`;
  assert.equal((await other.request(previewPath)).status, 404);
  const preview = await owner.request(previewPath);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.match(preview.headers.get("cache-control"), /no-store/);
  await change({
    action: "select",
    batchId: workspace.batches[1].id,
    index: 0,
  });
  assert.equal(workspace.assets[1].mime, "image/png");
  const image = await owner.request(
    `/api/workspace-assets/${workspace.assets[1].id}`,
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  const sharp = (await import("sharp")).default;
  const largeImage = await sharp(randomBytes(768 * 768 * 3), {
    raw: { width: 768, height: 768, channels: 3 },
  })
    .png()
    .toBuffer();
  assert.ok(largeImage.length > 1024 * 1024);
  const uploadKey = randomUUID();
  const uploadRevision = workspace.revision;
  function uploadBody(uid = owner.uid, revision = String(uploadRevision)) {
    const form = new FormData();
    form.set(
      "file",
      new Blob([largeImage], { type: "image/png" }),
      "large-private.png",
    );
    form.set("key", uploadKey);
    form.set("revision", revision);
    form.set("expectedUid", uid);
    return form;
  }
  assert.equal(
    (
      await owner.request(`${path}/uploads`, {
        method: "POST",
        body: uploadBody(),
        headers: { "x-csrf-token": "invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await other.request(`${path}/uploads`, {
        method: "POST",
        body: uploadBody(other.uid),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await owner.request(`${path}/uploads`, {
        method: "POST",
        body: uploadBody(other.uid),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await owner.request(`${path}/uploads`, {
        method: "POST",
        body: uploadBody(owner.uid, ""),
      })
    ).status,
    400,
  );
  const uploaded = await owner.request(`${path}/uploads`, {
    method: "POST",
    body: uploadBody(),
  });
  const uploadedWorkspace = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(uploadedWorkspace));
  assert.equal(uploadedWorkspace.assets.length, workspace.assets.length + 1);
  const replayed = await owner.request(`${path}/uploads`, {
    method: "POST",
    body: uploadBody(),
  });
  assert.equal(replayed.status, 201);
  assert.deepEqual(await replayed.json(), uploadedWorkspace);
  const privatePath = `/api/workspace-assets/${uploadedWorkspace.assets.at(-1).id}`;
  assert.equal((await other.request(privatePath)).status, 404);
  const downloaded = await owner.request(privatePath);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers.get("cache-control"), /private, no-store/);
  assert.ok((await downloaded.arrayBuffer()).byteLength > 1024 * 1024);
  workspace = uploadedWorkspace;
  const editTarget = workspace.artifacts.at(-1);
  assert.equal(
    (
      await owner.request("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          capability: "workspace-image",
          expectedUid: owner.uid,
          inputs: {
            prompt: "Forged references",
            context: "",
            referenceAssetIds: [workspace.assets.at(-1).id],
          },
        }),
      })
    ).status,
    409,
  );
  await change({
    action: "batch",
    capability: "workspace-image",
    prompt: "Edit this image using the selected reference",
    count: 1,
    targetId: editTarget.id,
    referenceAssetIds: [workspace.assets[1].id],
    dependencies: [],
    pricingKey: fingerprint({ mode: "fixed", credits: 1 }),
  });
  const editBatch = workspace.batches.at(-1);
  assert.equal(editBatch.editAssetId, editTarget.versions.at(-1).assetId);
  await runWorker();
  await change({ action: "select", batchId: editBatch.id, index: 0 });
  const edited = workspace.artifacts.find(
    (artifact) => artifact.id === editTarget.id,
  );
  assert.equal(edited.versions.length, 2);
  assert.notEqual(edited.versions[0].assetId, edited.versions[1].assetId);
  assert.equal(
    await db
      .collection("aiFiles")
      .countDocuments({ uid: owner.uid, type: "image", status: "ready" }),
    2,
  );
});

test(
  "AI HTTP accepts full-length multibyte prompts and retains body/schema limits",
  { skip: pricingMode },
  async () => {
    await createCreditIndexes(db);
    await createAiIndexes(db);
    const owner = await browser();
    await grantCredits(db, owner.uid, "unicode-fixture", {
      amount: 5,
      source: "purchase",
      reference: owner.uid,
    });
    for (const prompt of [
      "س".repeat(10000),
      "漢".repeat(10000),
      "😀".repeat(5000),
    ]) {
      const response = await owner.request("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          capability: "assistant-text",
          expectedUid: owner.uid,
          inputs: { prompt },
        }),
      });
      assert.equal(response.status, 202);
      const job = await response.json();
      assert.equal(job.inputs.prompt, prompt);
      // Drain each job so this test does not leave work for another test's worker.
      await runWorker();
    }
    assert.equal(
      (
        await owner.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify({
            key: randomUUID(),
            capability: "assistant-text",
            inputs: { prompt: "a".repeat(10001) },
          }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await owner.request("/api/ai/jobs", {
          method: "POST",
          body: " ".repeat(72 * 1024) + "{}",
        })
      ).status,
      413,
    );
  },
);

test(
  "production HTTP AI flows preserve ownership, accounting, files, conversations and administration",
  { skip: pricingMode },
  async () => {
    await createCreditIndexes(db);
    await createAiIndexes(db);
    const owner = await browser();
    const other = await browser();
    const admin = await browser();
    await appointFirstAdmin(db, admin.uid, "Owned AI HTTP fixture operator");
    for (const account of [owner, other])
      await grantCredits(db, account.uid, "fixture", {
        amount: 20,
        source: "purchase",
        reference: account.uid,
      });
    assert.equal((await fetch(`${origin}/api/ai/jobs`)).status, 401);
    assert.equal((await owner.request("/api/admin/ai/usage")).status, 403);
    const payload = {
      key: randomUUID(),
      capability: "assistant-text",
      inputs: { prompt: "Local fixture" },
      expectedUid: owner.uid,
    };
    assert.equal(
      (
        await owner.request("/api/ai/jobs", {
          method: "POST",
          headers: { "x-csrf-token": "" },
          body: JSON.stringify(payload),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await other.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      ).status,
      409,
    );
    const submitted = await owner.request("/api/ai/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.equal(submitted.status, 202);
    const job = await submitted.json();
    const duplicate = await owner.request("/api/ai/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert.equal((await duplicate.json()).id, job.id);
    assert.equal(
      await db
        .collection("creditReservations")
        .countDocuments({ uid: owner.uid }),
      1,
    );
    assert.equal((await other.request(`/api/ai/jobs/${job.id}`)).status, 404);
    await runWorker();
    const finished = await (
      await owner.request(`/api/ai/jobs/${job.id}`)
    ).json();
    assert.equal(finished.status, "succeeded");
    assert.match(finished.outputs.text, /Simulated response/);
    assert.equal(finished.usage.length, 1);
    assert.equal(finished.usage[0].cost, null);
    assert.equal((await readWallet(db, owner.uid)).balance, 19);
    assert.equal((await owner.request("/ai")).status, 200);
    assert.equal((await owner.request(`/ai/${job.id}`)).status, 200);

    const form = new FormData();
    form.set(
      "file",
      new File(["Owned document fixture"], "fixture.txt", {
        type: "text/plain",
      }),
    );
    form.set("key", randomUUID());
    form.set("capability", "document-summary");
    form.set("expectedUid", owner.uid);
    const upload = await owner.request("/api/ai/files", {
      method: "POST",
      body: form,
    });
    assert.equal(upload.status, 201);
    const file = await upload.json();
    assert.equal(file.status, "ready");
    const document = {
      key: randomUUID(),
      capability: "document-summary",
      inputs: { prompt: "Summarize", fileId: file.id },
    };
    assert.equal(
      (
        await other.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify(document),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await owner.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify(document),
        })
      ).status,
      202,
    );
    await runWorker();

    const chatPayload = {
      key: randomUUID(),
      capability: "assistant-chat",
      inputs: { prompt: "Hello" },
    };
    const chat = await (
      await owner.request("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify(chatPayload),
      })
    ).json();
    assert.ok(chat.conversationId);
    assert.equal(
      (
        await other.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify({
            ...chatPayload,
            key: randomUUID(),
            conversationId: chat.conversationId,
          }),
        })
      ).status,
      404,
    );
    await runWorker();
    const followup = await owner.request("/api/ai/jobs", {
      method: "POST",
      body: JSON.stringify({
        ...chatPayload,
        key: randomUUID(),
        conversationId: chat.conversationId,
      }),
    });
    assert.equal(followup.status, 202);
    await runWorker();

    const pending = await (
      await other.request("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          expectedUid: other.uid,
          key: randomUUID(),
        }),
      })
    ).json();
    await changeAccess(
      db,
      admin.uid,
      other.uid,
      { role: "member", status: "suspended" },
      "Verify pre-dispatch suspension",
      Math.floor(Date.now() / 1000),
    );
    await runWorker();
    assert.equal(
      (await db.collection("aiJobs").findOne({ _id: pending.id })).status,
      "cancelled",
    );
    assert.equal((await readWallet(db, other.uid)).balance, 20);
    const report = await admin.request("/api/admin/ai/usage");
    assert.equal(report.status, 200);
    assert.ok((await report.json()).length >= 4);
    assert.equal((await admin.request("/admin/ai")).status, 200);
  },
);

test(
  "variable pricing requires current terms and settles only actual usage",
  { skip: !pricingMode },
  async () => {
    const { fingerprint } = await import("../../src/lib/server/ai/jobs.ts");
    await createCreditIndexes(db);
    await createAiIndexes(db);
    const owner = await browser();
    await grantCredits(db, owner.uid, "pricing-fixture", {
      amount: 30,
      source: "purchase",
      reference: owner.uid,
    });
    const policies = JSON.parse(process.env.AI_PRICING_JSON);
    let balance = 30;
    for (const capability of ["assistant-text", "assistant-chat"]) {
      const payload = {
        key: randomUUID(),
        capability,
        expectedUid: owner.uid,
        inputs: { prompt: "Price fixture" },
      };
      for (const pricingKey of [undefined, "0".repeat(64)]) {
        const rejected = await owner.request("/api/ai/jobs", {
          method: "POST",
          body: JSON.stringify({ ...payload, pricingKey }),
        });
        assert.equal(rejected.status, 409);
      }
      const accepted = await owner.request("/api/ai/jobs", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          pricingKey: fingerprint(policies[capability]),
        }),
      });
      assert.equal(accepted.status, 202);
      const job = await accepted.json();
      assert.equal(job.credits, 10);
      assert.equal(job.chargedCredits, null);
      assert.equal((await readWallet(db, owner.uid)).reserved, 10);
      await runWorker();
      const done = await (await owner.request(`/api/ai/jobs/${job.id}`)).json();
      assert.equal(done.status, "succeeded");
      assert.equal(done.chargedCredits, 2);
      assert.deepEqual(done.pricing, policies[capability]);
      balance -= 2;
      const wallet = await readWallet(db, owner.uid);
      assert.equal(wallet.balance, balance);
      assert.equal(wallet.reserved, 0);
      const page = await owner.request(`/ai/${job.id}`);
      assert.equal(page.status, 200);
    }
  },
);
