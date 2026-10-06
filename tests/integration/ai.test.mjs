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
