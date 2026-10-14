import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";
assert.match(process.env.RATE_TEST_FIXTURE, /^[a-f0-9]{64}$/);
assert.equal(process.env.DIFY_MODE, "fake");
assert.match(
  process.env.REDIS_URL,
  /^redis:\/\/default:[A-Za-z0-9_-]+@127\.0\.0\.1:\d+$/,
);
assert.equal(process.env.APP_ORIGIN, "http://127.0.0.1:3101");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
assert.match(process.env.MONGODB_URI, /^mongodb:\/\/127\.0\.0\.1:\d+\//);
assert.match(process.env.MONGODB_DATABASE, /^unibase_test_[a-f0-9]+$/);
const origin = process.env.APP_ORIGIN;
const auth = getAuth(
  initializeApp({ projectId: "demo-unibase" }, `runs-${randomUUID()}`),
);
const mongo = new MongoClient(process.env.MONGODB_URI);
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
    const result = await fetch(`${options.replica ?? origin}${path}`, {
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
test("two web processes share limits, ignore spoofed IPs, expire and fail closed", async () => {
  const { createClient } = await import("redis");
  const { createHash } = await import("node:crypto");
  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", () => {});
  await redis.connect();
  const second = spawn(process.execPath, [".next/standalone/server.js"], {
    env: { ...process.env, PORT: "3102" },
    windowsHide: true,
    stdio: "inherit",
  });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch("http://127.0.0.1:3102/api/health/live")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    const owner = await browser();
    // The session is valid on both loopback ports; requests still use the exact configured Origin.
    const first = await owner.request("/api/profile");
    assert.equal(first.status, 200);
    const jarResponse = await owner.request("/api/profile");
    assert.equal(jarResponse.status, 200);
    // request helper can target the second replica without changing session state.
    assert.equal(
      (
        await owner.request("/api/profile", {
          replica: "http://127.0.0.1:3102",
        })
      ).status,
      200,
    );
    const denied = await owner.request("/api/profile", {
      headers: { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "9.8.7.6" },
    });
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    const key =
      "unibase:local:limits:read:" +
      createHash("sha256")
        .update("account:" + owner.uid)
        .digest("hex");
    const ttl = await redis.ttl(key);
    assert.ok(ttl > 0 && ttl <= 60);
    await redis.expire(key, 1);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await owner.request("/api/profile")).status, 200);
    // Exercise the actual limiter against the same Redis with immutable project
    // manifests replaced only inside these isolated test bundles.
    const { build } = await import("esbuild");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(".cache/rate-scope-tests", { recursive: true });
    for (const slug of ["scope-alpha", "scope-beta"]) {
      const outfile = `.cache/rate-scope-tests/${slug}-${randomUUID()}.cjs`;
      await build({
        bundle: true,
        platform: "node",
        format: "cjs",
        packages: "external",
        outfile,
        stdin: {
          resolveDir: process.cwd(),
          contents: `import assert from 'node:assert/strict';import {limitRequest} from './src/lib/server/rate-limit.ts';(async()=>{await limitRequest('same-owned-actor','read');await assert.rejects(limitRequest('same-owned-actor','read'),e=>e.code==='RATE_LIMITED');process.exit(0);})().catch(()=>process.exit(1));`,
        },
        plugins: [
          {
            name: "fixture-project",
            setup(build) {
              build.onLoad(
                { filter: /[\\/]src[\\/]lib[\\/]project\.ts$/ },
                () => ({
                  contents: `export const project={slug:${JSON.stringify(slug)}};`,
                  loader: "ts",
                }),
              );
            },
          },
        ],
      });
      for (const environment of ["staging", "production"]) {
        const result = spawnSync(
          process.execPath,
          ["--conditions=react-server", outfile],
          {
            env: {
              ...process.env,
              APP_ENV: environment,
              RATE_LIMITS_JSON: '{"read":1}',
            },
            encoding: "utf8",
            windowsHide: true,
            timeout: 10000,
          },
        );
        assert.equal(
          result.status,
          0,
          `Rate scope leaked for ${slug}/${environment}`,
        );
      }
    }
    // Fixture owns this Redis process; terminate it to exercise real connection loss.
    await redis.sendCommand(["SHUTDOWN", "NOSAVE"]).catch(() => {});
    assert.equal((await owner.request("/api/profile")).status, 503);
    assert.equal((await owner.request("/api/auth/csrf")).status, 200);
    assert.equal((await fetch(origin + "/api/health/live")).status, 200);
  } finally {
    if (redis.isOpen) redis.destroy();
    const stopped = once(second, "exit");
    second.kill();
    await stopped;
  }
});
