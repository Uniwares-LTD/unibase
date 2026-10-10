import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";

assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.equal(process.env.FIREBASE_PROJECT_ID, "demo-unitale");
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
assert.match(process.env.MONGODB_DATABASE, /^unitale_test_[a-f0-9]+$/);
const origin = process.env.APP_ORIGIN;
test("design showcase is unavailable in production", async () => {
  const response = await fetch(`${origin}/design-system`);
  assert.equal(response.status, 404);
  assert.ok(!(await response.text()).includes("Controls and form states"));
  assert.equal(
    (await fetch(`${origin}/design-system`, { method: "HEAD" })).status,
    404,
  );
});

test("runtime application name reaches metadata and the install manifest", async () => {
  const response = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.name, "Base runtime fixture");
  assert.equal(manifest.short_name, manifest.name);
  assert.equal(manifest.description, "Your space in Base runtime fixture.");
  assert.equal(manifest.start_url, "/");
  const html = await (await fetch(origin)).text();
  assert.match(html, /<title>Base runtime fixture<\/title>/);
  assert.match(
    html,
    /name="description" content="Your space in Base runtime fixture\."/,
  );
});

test("initial HTML resolves runtime style defaults and allowlisted browser cookies", async () => {
  for (const [cookie, expected] of [
    ["", "glass"],
    ["unitale-style=classic", "classic"],
    ["unitale-style=glass", "glass"],
    ["unitale-style=soft-blue", "soft-blue"],
    ["unitale-style=unknown", "glass"],
  ]) {
    const response = await fetch(origin, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.match(
      await response.text(),
      new RegExp(`<html[^>]*data-style="${expected}"`),
    );
  }
});
test("health distinguishes a live process from healthy required dependencies", async () => {
  const live = await fetch(`${origin}/api/health/live`);
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("cache-control"), "no-store");
  assert.deepEqual(await live.json(), { status: "live" });
  const ready = await fetch(`${origin}/api/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ready.json(), {
    status: "ready",
    commit: "a".repeat(40),
  });
});
const auth = getAuth(initializeApp({ projectId: "demo-unitale" }, "tests"));
const users = [];
async function identity(method, body) {
  const response = await fetch(
    `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${method}?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}
async function account() {
  const email = `${randomUUID()}@example.test`,
    password = "test-password-1234";
  const result = await identity("signUp", {
    email,
    password,
    returnSecureToken: true,
  });
  assert.equal(result.status, 200);
  users.push(result.body.localId);
  return { ...result.body, email, password };
}
function browser() {
  const jar = new Map();
  return async (pathname, options = {}) => {
    const response = await fetch(`${origin}${pathname}`, {
      ...options,
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        origin,
        "content-type": "application/json",
        ...options.headers,
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0];
      const i = first.indexOf("=");
      jar.set(first.slice(0, i), first.slice(i + 1));
    }
    return response;
  };
}
test("real emulator sessions enforce ownership, verification, CSRF and revocation", async () => {
  const request = browser();
  const anon = await request("/api/profile");
  assert.equal(anon.status, 401);
  assert.equal(
    (
      await request("/api/profile", {
        headers: { cookie: "unitale-session=invalid-token" },
      })
    ).status,
    401,
  );
  const failure = await anon.json();
  assert.equal(failure.error.requestId, anon.headers.get("x-request-id"));
  const user = await account();
  const badLogin = await identity("signInWithPassword", {
    email: `missing-${randomUUID()}@example.test`,
    password: user.password,
    returnSecureToken: true,
  });
  assert.equal(badLogin.status, 400);
  const csrf = (await (await request("/api/auth/csrf")).json()).token;
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({ idToken: "invalid" }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({ idToken: "x".repeat(22000) }),
      })
    ).status,
    413,
  );
  assert.equal((await request("/__/auth/arbitrary-path")).status, 404);
  const login = () =>
    request("/api/auth/session", {
      method: "POST",
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({ idToken: user.idToken }),
    });
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ idToken: user.idToken }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        headers: { origin: "https://attacker.example", "x-csrf-token": csrf },
        body: JSON.stringify({ idToken: user.idToken }),
      })
    ).status,
    403,
  );
  const session = await login();
  assert.equal(session.status, 200);
  assert.match(session.headers.getSetCookie().join(";"), /HttpOnly/i);
  assert.match(session.headers.getSetCookie().join(";"), /SameSite=lax/i);
  assert.match(session.headers.getSetCookie().join(";"), /Max-Age=432000/i);
  assert.equal((await request("/api/profile")).status, 403);
  await auth.updateUser(user.localId, { emailVerified: true });
  user.idToken = (
    await identity("signInWithPassword", {
      email: user.email,
      password: user.password,
      returnSecureToken: true,
    })
  ).body.idToken;
  assert.equal((await login()).status, 200);
  const profile = await (await request("/api/profile")).json();
  assert.equal(profile.uid, user.localId);
  assert.equal(profile.style, "default");
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({
          uid: "someone-else",
          displayName: "Bad",
          theme: "dark",
        }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({
          displayName: "Saved name",
          theme: "dark",
          style: "soft-blue",
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/api/profile")).json()).displayName,
    "Saved name",
  );
  assert.equal(
    (await (await request("/api/profile")).json()).style,
    "soft-blue",
  );
  // Older clients omit style; they must preserve the existing saved preference.
  assert.equal(
    (
      await request("/api/profile", {
        method: "PATCH",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({ displayName: "Saved name", theme: "dark" }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/api/profile")).json()).style,
    "soft-blue",
  );
  const second = await account();
  await auth.updateUser(second.localId, { emailVerified: true });
  const secondToken = (
    await identity("signInWithPassword", {
      email: second.email,
      password: second.password,
      returnSecureToken: true,
    })
  ).body.idToken;
  const other = browser();
  const otherCsrf = (await (await other("/api/auth/csrf")).json()).token;
  await other("/api/auth/session", {
    method: "POST",
    headers: { "x-csrf-token": otherCsrf },
    body: JSON.stringify({ idToken: secondToken }),
  });
  assert.equal(
    (await (await other("/api/profile")).json()).uid,
    second.localId,
  );
  assert.equal(
    (await (await request("/api/profile")).json()).displayName,
    "Saved name",
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await auth.revokeRefreshTokens(user.localId);
  assert.equal((await request("/api/profile")).status, 401);
  assert.equal(
    (
      await other("/api/auth/session", {
        method: "DELETE",
        headers: { "x-csrf-token": otherCsrf },
      })
    ).status,
    200,
  );
  assert.equal((await other("/api/profile")).status, 401);
  const dbClient = new MongoClient(process.env.MONGODB_URI);
  try {
    const docs = await dbClient
      .db(process.env.MONGODB_DATABASE)
      .collection("profiles")
      .find()
      .toArray();
    assert.equal(docs.length, 2);
    for (const doc of docs) {
      assert.ok(!("password" in doc));
      assert.ok(!("idToken" in doc));
    }
  } finally {
    await dbClient.close();
  }
});

test("public PWA assets and debug headers preserve safe HTTP boundaries", async () => {
  const response = await fetch(`${origin}/api/profile?token=secret-query`, {
    headers: {
      "x-debug": "true",
      "x-request-id": "secret-injected-id",
      cookie: "unitale-session=secret-cookie",
    },
  });
  assert.equal(response.status, 401);
  const failure = await response.json();
  assert.deepEqual(Object.keys(failure.error).sort(), [
    "code",
    "message",
    "requestId",
  ]);
  assert.equal(JSON.stringify(failure).includes("secret"), false);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const resource = await fetch(`${origin}${icon.src}`);
    assert.equal(resource.status, 200);
    assert.match(resource.headers.get("content-type"), /image\/png/);
  }
  const worker = await fetch(`${origin}/sw.js`);
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get("cache-control"), /no-store/);
  assert.deepEqual(
    await (await fetch(`${origin}/.well-known/assetlinks.json`)).json(),
    [],
  );
});
test("admin routes use current database permissions and suspension prevents old-session revival", async () => {
  const request = browser();
  assert.equal((await request("/api/admin/users")).status, 401);
  const user = await account();
  await auth.updateUser(user.localId, { emailVerified: true });
  user.idToken = (
    await identity("signInWithPassword", {
      email: user.email,
      password: user.password,
      returnSecureToken: true,
    })
  ).body.idToken;
  const csrf = (await (await request("/api/auth/csrf")).json()).token;
  const login = () =>
    request("/api/auth/session", {
      method: "POST",
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({ idToken: user.idToken }),
    });
  assert.equal((await login()).status, 200);
  assert.equal((await request("/api/admin/users")).status, 403);
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    const access = client
      .db(process.env.MONGODB_DATABASE)
      .collection("accountAccess");
    await access.insertOne({
      _id: user.localId,
      role: "admin",
      status: "active",
      notBefore: 0,
      revision: 1,
      updatedAt: new Date(),
    });
    const page = await request(
      `/admin/users?q=${encodeURIComponent(user.email)}`,
    );
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Manage/);
    await access.updateOne({ _id: user.localId }, { $set: { role: "member" } });
    assert.equal((await request("/api/admin/users")).status, 403);
    await access.updateOne(
      { _id: user.localId },
      {
        $set: {
          status: "suspended",
          notBefore: Math.floor(Date.now() / 1000) + 1,
        },
      },
    );
    assert.equal((await request("/api/profile")).status, 401);
    assert.equal((await login()).status, 403);
    await access.updateOne(
      { _id: user.localId },
      { $set: { status: "active" } },
    );
    assert.equal((await request("/api/profile")).status, 401);
    assert.equal((await login()).status, 403);
  } finally {
    await client.close();
  }
});

test("credit reads require verified sessions and cannot select another user's wallet", async () => {
  const request = browser();
  assert.equal((await request("/api/credits")).status, 401);
  const user = await account();
  const csrf = (await (await request("/api/auth/csrf")).json()).token;
  const login = () =>
    request("/api/auth/session", {
      method: "POST",
      headers: { "x-csrf-token": csrf },
      body: JSON.stringify({ idToken: user.idToken }),
    });
  assert.equal((await login()).status, 200);
  assert.equal((await request("/api/credits")).status, 403);
  await auth.updateUser(user.localId, { emailVerified: true });
  user.idToken = (
    await identity("signInWithPassword", {
      email: user.email,
      password: user.password,
      returnSecureToken: true,
    })
  ).body.idToken;
  assert.equal((await login()).status, 200);
  const first = await request("/api/credits");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  const empty = await first.json();
  assert.equal(empty.balance, 0);
  assert.deepEqual(empty.history, []);
  const other = await account();
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DATABASE);
    // Finalized grants are fixture data here; real transaction behavior is
    // covered by the replica-set credit tests. All records are in the test DB.
    for (const [uid, amount] of [
      [user.localId, 42],
      [other.localId, 99],
    ]) {
      await db.collection("creditWallets").updateOne(
        { _id: uid },
        {
          $set: {
            balance: amount,
            reserved: 0,
            debt: 0,
            sequence: 1,
            revision: 1,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
      await db.collection("creditLots").insertOne({
        _id: randomUUID(),
        uid,
        source: "purchase",
        reference: `http-fixture:${uid}`,
        originalCredits: amount,
        reversedCredits: 0,
        remaining: amount,
        reserved: 0,
        expiresAt: null,
        createdAt: new Date(),
      });
      await db.collection("creditLedger").insertOne({
        _id: randomUUID(),
        uid,
        sequence: 1,
        kind: "grant",
        delta: amount,
        reservedDelta: 0,
        balanceAfter: amount,
        reservedAfter: 0,
        debtAfter: 0,
        reference: "fixture",
        operationId: "private-fixture-operation",
        timestamp: new Date(),
      });
    }
    const result = await (
      await request(`/api/credits?uid=${other.localId}`)
    ).json();
    assert.equal(result.available, 42);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0].delta, 42);
    assert.equal(JSON.stringify(result).includes(other.localId), false);
    assert.equal(JSON.stringify(result).includes("private-fixture"), false);
    assert.equal(
      (await request("/api/credits?before=bad-secret-value")).status,
      400,
    );
    assert.equal(
      (
        await request("/api/credits", {
          method: "POST",
          body: JSON.stringify({ amount: 1000 }),
        })
      ).status,
      405,
    );
    const page = await request("/credits");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Local purchase simulation/);
    await db
      .collection("accountAccess")
      .updateOne({ _id: user.localId }, { $set: { status: "suspended" } });
    assert.equal((await request("/api/credits")).status, 401);
  } finally {
    await client.close();
  }
});

test("admin reports store sanitized request outcomes and reject stale permissions", async () => {
  const request = browser();
  assert.equal((await request("/api/admin/reports")).status, 401);
  const secretProbe = await request("/api/profile?token=runtime-secret-query", {
    headers: {
      cookie: "unitale-session=runtime-secret-cookie",
      "x-request-id": "runtime-secret-id",
      "x-debug": "true",
    },
  });
  assert.equal(secretProbe.status, 401);
  const requestId = secretProbe.headers.get("x-request-id");
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  const user = await account();
  await auth.updateUser(user.localId, { emailVerified: true });
  user.idToken = (
    await identity("signInWithPassword", {
      email: user.email,
      password: user.password,
      returnSecureToken: true,
    })
  ).body.idToken;
  const csrf = (await (await request("/api/auth/csrf")).json()).token;
  assert.equal(
    (
      await request("/api/auth/session", {
        method: "POST",
        headers: { "x-csrf-token": csrf },
        body: JSON.stringify({ idToken: user.idToken }),
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/admin/reports")).status, 403);
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    const db = client.db(process.env.MONGODB_DATABASE);
    await db.collection("accountAccess").updateOne(
      { _id: user.localId },
      {
        $set: {
          role: "admin",
          status: "active",
          notBefore: 0,
          revision: 1,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    let stored;
    for (let i = 0; i < 50; i++) {
      stored = await db.collection("runtimeLogs").findOne({ requestId });
      if (stored) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(stored);
    assert.equal(stored.status, 401);
    assert.equal(stored.severity, "warn");
    assert.equal(JSON.stringify(stored).includes("runtime-secret"), false);
    assert.deepEqual(Object.keys(stored).sort(), [
      "_id",
      "durationMs",
      "event",
      "requestId",
      "severity",
      "status",
      "timestamp",
    ]);
    const response = await request(
      `/api/admin/reports?requestId=${requestId}&severity=warn&event=request`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const report = await response.json();
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].requestId, requestId);
    assert.equal(JSON.stringify(report).includes("runtime-secret"), false);
    const bad = await request(
      "/api/admin/reports?severity=runtime-secret-invalid",
    );
    assert.equal(bad.status, 400);
    assert.equal(
      JSON.stringify(await bad.json()).includes("runtime-secret"),
      false,
    );
    const page = await request("/admin");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Application profiles/);
    const view = await request("/admin/reports?kind=runtime");
    assert.equal(view.status, 200);
    assert.match(await view.text(), /Runtime events/);
    await db
      .collection("accountAccess")
      .updateOne({ _id: user.localId }, { $set: { role: "member" } });
    assert.equal((await request("/api/admin/reports")).status, 403);
  } finally {
    await client.close();
  }
});

after(async () => {
  for (const uid of users) await auth.deleteUser(uid);
});
