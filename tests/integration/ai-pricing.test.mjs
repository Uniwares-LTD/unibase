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

test("Pricing HTTP: five modes, consent, reservations, rounding and replay settlement", async () => {
  await createCreditIndexes(db);
  await createAiIndexes(db);
  const owner = await browser();
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
  await grantCredits(db, owner.uid, "pricing-seed", {
    amount: 100,
    source: "purchase",
    reference: owner.uid,
  });
  const scenarios = [
    [{ mode: "fixed", credits: 3 }, 3, "priced-usage"],
    [
      {
        mode: "tokens",
        maxCredits: 10,
        rate: { basis: "total", creditsPerMillion: "100001" },
      },
      2,
      "priced-usage",
    ],
    [
      {
        mode: "tokens",
        maxCredits: 10,
        rate: {
          basis: "split",
          inputCreditsPerMillion: "100000",
          outputCreditsPerMillion: "200000",
        },
      },
      2,
      "priced-usage",
    ],
    [
      {
        mode: "provider-cost",
        maxCredits: 10,
        currency: "USD",
        creditsPerCurrencyUnit: "1000",
      },
      3,
      "priced-usage",
    ],
    [
      {
        mode: "hybrid",
        maxCredits: 10,
        baseCredits: 2,
        usage: {
          mode: "tokens",
          rate: { basis: "total", creditsPerMillion: "100001" },
        },
      },
      4,
      "priced-usage",
    ],
    [{ mode: "fixed", credits: 3 }, 0, "fail"],
    [
      {
        mode: "tokens",
        maxCredits: 10,
        rate: { basis: "total", creditsPerMillion: "100001" },
      },
      2,
      "fail priced-usage",
      "verified-usage",
    ],
    [
      {
        mode: "tokens",
        maxCredits: 10,
        rate: { basis: "total", creditsPerMillion: "100001" },
      },
      null,
      "missing-usage",
    ],
  ];
  const catalog = async () =>
    (await (await owner.request("/api/admin/orchestrators")).json()).find(
      (d) => d.id === "demo",
    );
  for (const [
    pricing,
    charge,
    prompt,
    failureCharging = "success-only",
  ] of scenarios) {
    const old = await catalog();
    const settings = await (await owner.request("/api/admin/settings")).json();
    const response = await owner.request("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        revision: settings.revision,
        reason: "HTTP pricing fixture",
        settings: {
          ...settings.settings,
          runs: { ...settings.settings.runs, pricing, failureCharging },
        },
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const before = await readWallet(db, owner.uid);
    const key = randomUUID();
    const input = {
      key,
      orchestratorId: "demo",
      configurationKey: old.configurationKey,
      inputs: { prompt },
    };
    const post = (body) =>
      owner.request("/api/runs", {
        method: "POST",
        body: JSON.stringify(body),
      });
    assert.equal((await post(input)).status, 409, "stale pricing consent");
    assert.equal((await readWallet(db, owner.uid)).reserved, before.reserved);
    input.configurationKey = (await catalog()).configurationKey;
    const started = await post(input);
    assert.equal(started.status, 202, await started.clone().text());
    const { id } = await started.json();
    const maximum =
      pricing.mode === "fixed" ? pricing.credits : pricing.maxCredits;
    assert.equal(
      (await readWallet(db, owner.uid)).reserved,
      before.reserved + maximum,
    );
    await runWorker();
    const detail = await (await owner.request(`/api/runs/${id}`)).json();
    if (charge === null) {
      assert.equal(detail.status, "needs-review");
      assert.equal(
        (await readWallet(db, owner.uid)).reserved,
        before.reserved + maximum,
      );
    } else {
      assert.equal(detail.attempts.at(-1).chargedCredits, charge);
      assert.equal((await readWallet(db, owner.uid)).reserved, before.reserved);
      assert.equal(
        (await readWallet(db, owner.uid)).available,
        before.available - charge,
      );
    }
    const settled = await readWallet(db, owner.uid);
    assert.equal((await (await post(input)).json()).id, id);
    await runWorker();
    assert.deepEqual(await readWallet(db, owner.uid), settled);
  }
});
