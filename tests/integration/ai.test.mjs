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
} from "./dify-keys-fixture.mjs";

assert.equal(process.env.DIFY_MODE, "fake");
assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
assert.match(process.env.MONGODB_DATABASE, /^unitale_test_[a-f0-9]+$/);
const origin = process.env.APP_ORIGIN;
const auth = getAuth(
  initializeApp({ projectId: "demo-unitale" }, `runs-${randomUUID()}`),
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

test("Runs HTTP: durable decisions, owned history, recovery, settings, and exactly-once billing", async () => {
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
  assert.equal((await other.request("/api/admin/settings")).status, 403);
  assert.equal(
    (
      await owner.request("/api/admin/settings", {
        method: "POST",
        body: "{}",
        headers: { "x-csrf-token": "bad" },
      })
    ).status,
    403,
  );
  for (const route of [
    "/runs/new",
    "/runs",
    "/admin/settings",
    "/admin/orchestrators",
    "/admin/ai",
  ])
    assert.equal((await owner.request(route)).status, 200, route);
  assert.equal((await owner.request("/workspaces")).status, 404);
  assert.equal((await owner.request("/ai")).status, 404);
  const catalog = await (
    await owner.request("/api/admin/orchestrators")
  ).json();
  const demo = catalog.find((d) => d.id === "demo");
  assert.ok(demo.ready);
  const settings = await (await owner.request("/api/admin/settings")).json();
  const start = async (prompt) => {
    const body = {
      key: randomUUID(),
      orchestratorId: "demo",
      configurationKey: demo.configurationKey,
      inputs: { prompt },
    };
    const response = await owner.request("/api/runs", {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 202, await response.clone().text());
    return { body, ...(await response.json()) };
  };
  const run = await start("decision");
  assert.equal((await readWallet(db, owner.uid)).reserved, 1);
  const replay = await (
    await owner.request("/api/runs", {
      method: "POST",
      body: JSON.stringify(run.body),
    })
  ).json();
  assert.equal(replay.id, run.id);
  assert.equal((await other.request(`/api/runs/${run.id}`)).status, 404);
  await runWorker();
  let detail = await (await owner.request(`/api/runs/${run.id}`)).json();
  assert.equal(detail.status, "awaiting input");
  assert.equal(detail.decisions.length, 1);
  assert.ok(!JSON.stringify(detail).includes('"token"'));
  const decision = detail.decisions[0];
  assert.equal(
    (
      await other.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          action: "continue",
          answers: { direction: "brief" },
        }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await owner.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          action: "forged",
          answers: { direction: "brief" },
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify({
          key: randomUUID(),
          action: "continue",
          answers: { direction: "forged-choice" },
        }),
      })
    ).status,
    400,
  );
  const answer = {
    key: randomUUID(),
    action: "continue",
    answers: { direction: "brief" },
  };
  assert.equal(
    (
      await owner.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify(answer),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request(`/api/runs/${run.id}/decisions/${decision.id}`, {
        method: "POST",
        body: JSON.stringify(answer),
      })
    ).status,
    200,
  );
  await db
    .collection("aiJobs")
    .updateOne(
      { _id: run.attemptId },
      { $set: { nextAttemptAt: new Date(0) } },
    );
  await runWorker();
  detail = await (await owner.request(`/api/runs/${run.id}`)).json();
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.attempts[0].chargedCredits, 1);
  assert.equal((await readWallet(db, owner.uid)).balance, 29);
  const lost = await start("decision lost");
  await runWorker();
  const lostDetail = await (await owner.request(`/api/runs/${lost.id}`)).json();
  const lostDecision = lostDetail.decisions[0];
  const lostAnswer = {
    key: randomUUID(),
    action: "continue",
    answers: { direction: "brief" },
  };
  const outcomes = await Promise.all(
    [
      lostAnswer,
      { ...lostAnswer, key: randomUUID(), answers: { direction: "detailed" } },
    ].map((body) =>
      owner.request(`/api/runs/${lost.id}/decisions/${lostDecision.id}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    ),
  );
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  await db
    .collection("aiJobs")
    .updateOne(
      { _id: lost.attemptId },
      { $set: { nextAttemptAt: new Date(0) } },
    );
  await runWorker();
  const confirmed = await (await owner.request(`/api/runs/${lost.id}`)).json();
  assert.equal(confirmed.status, "succeeded");
  assert.equal(confirmed.decisions[0].status, "submitted");
  const failure = await start("fail");
  await runWorker();
  detail = await (await owner.request(`/api/runs/${failure.id}`)).json();
  assert.equal(detail.status, "failed");
  assert.ok(detail.canRestart);
  assert.equal(detail.attempts[0].chargedCredits, 0);
  assert.ok(detail.attempts[0].failure);
  // Historical failed attempts may have no recorded provider diagnosis.
  await db
    .collection("aiJobs")
    .updateOne(
      { _id: failure.attemptId },
      { $set: { failure: null }, $unset: { "execution.failure": "" } },
    );
  const historical = await (
    await owner.request(`/api/runs/${failure.id}`)
  ).json();
  assert.match(historical.attempts[0].failure, /No error details were saved/);
  const recover = {
    key: randomUUID(),
    action: "recover",
    attemptId: failure.attemptId,
    configurationKey: demo.configurationKey,
    stage: "draft",
  };
  const recovered = await owner.request(`/api/runs/${failure.id}`, {
    method: "POST",
    body: JSON.stringify(recover),
  });
  assert.equal(recovered.status, 202, await recovered.clone().text());
  await runWorker();
  detail = await (await owner.request(`/api/runs/${failure.id}`)).json();
  assert.equal(detail.status, "succeeded");
  assert.equal(detail.attempts.length, 2);
  const partial = await start("partial");
  await runWorker();
  const partialDetail = await (
    await owner.request(`/api/runs/${partial.id}`)
  ).json();
  assert.equal(partialDetail.status, "partially completed");
  assert.equal(partialDetail.attempts[0].failure, null);
  const pending = await start("hello");
  const update = {
    revision: settings.revision,
    reason: "Change admission price for new attempts",
    settings: {
      ...settings.settings,
      runs: {
        ...settings.settings.runs,
        pricing: { mode: "fixed", credits: 2 },
      },
    },
  };
  assert.equal(
    (
      await owner.request("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify(update),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify(update),
      })
    ).status,
    409,
  );
  await runWorker();
  assert.equal(
    (await (await owner.request(`/api/runs/${pending.id}`)).json()).attempts[0]
      .chargedCredits,
    1,
  );
  assert.equal(
    (
      await owner.request("/api/runs", {
        method: "POST",
        body: JSON.stringify(pending.body),
      })
    ).status,
    202,
  );
  const changed = await owner.request("/api/runs", {
    method: "POST",
    body: JSON.stringify({ ...pending.body, key: randomUUID() }),
  });
  assert.equal(changed.status, 409);
  const list = await (await owner.request("/api/runs")).json();
  assert.ok(list.rows.some((r) => r.id === run.id));
  assert.equal(list.rows.filter((r) => r.id === failure.id).length, 1);
  // Manual definitions and the former multi-step management surface are paused.
  assert.equal(
    (
      await owner.request("/api/admin/orchestrators", {
        method: "POST",
        body: JSON.stringify({}),
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await owner.request("/api/admin/orchestrators/manage", {
        method: "POST",
        body: JSON.stringify({ action: "validate", definition: {} }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.request("/api/admin/orchestrators/manage", {
        method: "POST",
        body: JSON.stringify({ action: "discover" }),
      })
    ).status,
    200,
  );
  if (process.env.DIFY_KEYS_TEST) {
    for (const appId of [existingApp, emptyApp]) {
      assert.equal(
        (
          await other.request("/api/admin/orchestrators/manage", {
            method: "POST",
            body: JSON.stringify({ action: "register", appId }),
          })
        ).status,
        403,
      );
      const response = await owner.request("/api/admin/orchestrators/manage", {
        method: "POST",
        body: JSON.stringify({ action: "register", appId }),
      });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.ok(!text.includes(existingToken) && !text.includes(createdToken));
      assert.equal(JSON.parse(text).status, "ready");
    }
  }
});
