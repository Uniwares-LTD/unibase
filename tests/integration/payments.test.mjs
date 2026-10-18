import {
  fixtureProjectId,
  fixtureDatabasePattern,
  fixtureCookie,
} from "./project-fixture.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.PAYMENTS_MODE, "stripe");
assert.equal(process.env.STRIPE_SECRET_KEY, "sk_test_fixture");
assert.match(process.env.MONGODB_DATABASE, fixtureDatabasePattern);
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
const origin = process.env.APP_ORIGIN;
const sdk = new Stripe("sk_test_fixture"); // Only signs fixtures; no provider calls.
test("verified member sees Stripe purchase UI without private configuration", async () => {
  assert.equal(process.env.FIREBASE_PROJECT_ID, fixtureProjectId);
  assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST, /^127\.0\.0\.1:\d+$/);
  const app = initializeApp(
    { projectId: fixtureProjectId },
    "owned-stripe-page-fixture",
  );
  const auth = getAuth(app);
  const email = `${randomUUID()}@example.test`,
    password = "Owned-stripe-fixture-1234!";
  const identity = async (method) =>
    await (
      await fetch(
        `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        },
      )
    ).json();
  const signup = await identity("signUp");
  assert.ok(signup.localId);
  try {
    await auth.updateUser(signup.localId, { emailVerified: true });
    const login = await identity("signInWithPassword");
    const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
    const csrfCookie = csrfResponse.headers.get("set-cookie").split(";")[0];
    const { token } = await csrfResponse.json();
    const session = await fetch(`${origin}/api/auth/session`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: csrfCookie,
        "x-csrf-token": token,
      },
      body: JSON.stringify({ idToken: login.idToken }),
    });
    assert.equal(session.status, 200);
    const cookie = session.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${fixtureCookie("session")}=`))
      .split(";")[0];
    const page = await fetch(`${origin}/credits`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Buy credits/);
    assert.match(html, /Owned Stripe fixture/);
    assert.doesNotMatch(html, /sk_test_fixture|whsec_fixture|price_fixture/);
    // Translated client dictionaries in RSC scripts include labels for hidden
    // controls. Check rendered markup rather than all serialized catalog text.
    assert.doesNotMatch(
      html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""),
      /Local purchase simulation/,
    );
  } finally {
    await auth.deleteUser(signup.localId);
    await deleteApp(app);
  }
});
test("raw signed HTTP notifications enter a durable allowlisted inbox once", async () => {
  const payload = JSON.stringify({
    id: "evt_ownedfixture",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_ownedfixture",
        email: "private@example.test",
        metadata: { private: "do-not-store" },
      },
    },
  });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const send = (raw, signature) =>
    fetch(`${origin}/api/payments/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: raw,
    });
  const header = sdk.webhooks.generateTestHeaderString({ payload, secret });
  for (let i = 0; i < 2; i++) {
    const response = await send(payload, header);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await send(`${payload} `, header)).status, 400);
  assert.equal(
    (
      await send(
        payload,
        sdk.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp: 1,
        }),
      )
    ).status,
    400,
  );
  const live = payload.replace('"livemode":false', '"livemode":true');
  assert.equal(
    (
      await send(
        live,
        sdk.webhooks.generateTestHeaderString({ payload: live, secret }),
      )
    ).status,
    400,
  );
  const unknown = payload.replace(
    "checkout.session.completed",
    "customer.created",
  );
  assert.equal(
    (
      await send(
        unknown,
        sdk.webhooks.generateTestHeaderString({ payload: unknown, secret }),
      )
    ).status,
    200,
  );
  assert.equal((await send("x".repeat(256001), header)).status, 413);
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    const rows = await client
      .db(process.env.MONGODB_DATABASE)
      .collection("paymentInbox")
      .find({})
      .toArray();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "pending");
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      [
        "_id",
        "provider",
        "type",
        "objectId",
        "status",
        "attempts",
        "nextAt",
        "createdAt",
      ].sort(),
    );
    assert.equal(
      await client
        .db(process.env.MONGODB_DATABASE)
        .collection("creditLedger")
        .countDocuments({}),
      0,
    );
  } finally {
    await client.close();
  }
});
test("checkout HTTP mutations require CSRF and authenticated ownership before contacting Stripe", async () => {
  const request = async (body, headers = {}) =>
    fetch(`${origin}/api/payments/stripe/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await request({ packId: "fixture", key: "owned-key" })).status,
    403,
  );
  const csrfResponse = await fetch(`${origin}/api/auth/csrf`);
  const cookie = csrfResponse.headers.get("set-cookie").split(";")[0];
  const { token } = await csrfResponse.json();
  const headers = { cookie, "x-csrf-token": token };
  assert.equal(
    (await request({ packId: "fixture", key: "owned-key" }, headers)).status,
    401,
  );
  assert.equal(
    (
      await request(
        { packId: "fixture", key: "owned-key", uid: "other", credits: 10000 },
        headers,
      )
    ).status,
    // The shared boundary authenticates before exposing validation details.
    401,
  );
});
