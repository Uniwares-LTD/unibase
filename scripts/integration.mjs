import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { prepareStandalone } from "./standalone.mjs";

// All targets are owned by this runner. Never load .env files or accept Atlas
// connection strings for tests. The auth emulator must already be running.
await fetch("http://127.0.0.1:9099/", { signal: AbortSignal.timeout(3000) });
const mongo = await MongoMemoryReplSet.create({
  binary: { downloadDir: path.resolve(".cache/mongodb-binaries") },
  replSet: { count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
});
const database = `unitale_test_${randomUUID().replaceAll("-", "")}`;
const client = new MongoClient(mongo.getUri());
await client
  .db(database)
  .collection("profiles")
  .createIndex({ uid: 1 }, { unique: true, name: "unique_firebase_uid" });
await client.close();
const env = {
  ...process.env,
  NODE_ENV: "production",
  APP_ENV: "local",
  // Different from the build default to verify runtime configuration.
  APP_STYLE: "glass",
  APP_NAME: "Base runtime fixture",
  APP_ORIGIN: "http://127.0.0.1:3101",
  AUTH_MODE: "emulator",
  FIREBASE_PROJECT_ID: "demo-unitale",
  FIREBASE_API_KEY: "demo-key",
  FIREBASE_APP_ID: "demo-app",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  MONGODB_URI: mongo.getUri(),
  MONGODB_DATABASE: database,
  PAYMENTS_MODE: process.argv.includes("--stripe") ? "stripe" : "simulation",
  ASSET_STORE: "mongo",
  DIFY_MODE: process.argv.includes("--orchestrators")
    ? "live"
    : process.argv.includes("--ai")
      ? "fake"
      : "disabled",
  DIFY_BASE_URL: "",
  DIFY_ORCHESTRATORS_JSON: "",
  DIFY_MANAGEMENT_KEY: "",
  DIFY_WORKSPACE_ID: "",
  DIFY_CONSOLE_URL: "",
  DIFY_CREDENTIAL_ENCRYPTION_KEY: "",
  DIFY_KEYS_TEST: "",
  CREDIT_PACKS_JSON: process.argv.includes("--stripe")
    ? JSON.stringify([
        {
          id: "fixture",
          label: "Owned Stripe fixture",
          credits: 100,
          stripePriceId: "price_fixture",
          amountMinor: 300,
          currency: "usd",
        },
      ])
    : "",
  STRIPE_SECRET_KEY: process.argv.includes("--stripe") ? "sk_test_fixture" : "",
  STRIPE_WEBHOOK_SECRET: process.argv.includes("--stripe")
    ? "whsec_fixture"
    : "",
  // Empty values override both inherited variables and Next.js env files.
  // Android association is not part of this isolated test environment.
  ANDROID_HOST: "",
  ANDROID_PACKAGE_NAME: "",
  ANDROID_SHA256_FINGERPRINTS: "",
  RELEASE_COMMIT: "a".repeat(40),
  HOSTNAME: "127.0.0.1",
  PORT: "3101",
};
let difyKeys;
if (
  process.argv.includes("--dify-keys") ||
  process.argv.includes("--orchestrators")
) {
  const { difyKeysFixture } =
    await import("../tests/integration/dify-keys-fixture.mjs");
  difyKeys = await difyKeysFixture();
  Object.assign(env, difyKeys.env);
}
const app = spawn(process.execPath, [prepareStandalone()], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
try {
  let available = false;
  for (let i = 0; i < 60; i++) {
    if (app.exitCode !== null)
      throw new Error("Test server exited before readiness.");
    try {
      const response = await fetch(`${env.APP_ORIGIN}/api/auth/csrf`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!available) throw new Error("Test server did not become ready.");
  if (process.argv.includes("--browser")) {
    if (difyKeys) console.log(`Local Dify fixture: ${env.DIFY_CONSOLE_URL}`);
    const { browserFixture } =
      await import("../tests/integration/browser-fixture.mjs");
    await browserFixture(env);
  } else {
    const test = spawn(
      process.execPath,
      [
        ...(process.argv.includes("--ai") ||
        process.argv.includes("--orchestrators")
          ? ["--conditions=react-server", "--import", "tsx"]
          : []),
        "--test",
        process.argv.includes("--orchestrators")
          ? "tests/integration/orchestrators.test.mjs"
          : process.argv.includes("--ai")
            ? process.argv.includes("--rate-limits")
              ? "tests/integration/rate-limits.test.mjs"
              : process.argv.includes("--ai-pricing")
                ? "tests/integration/ai-pricing.test.mjs"
                : "tests/integration/ai.test.mjs"
            : process.argv.includes("--stripe")
              ? "tests/integration/payments.test.mjs"
              : "tests/integration/auth.test.mjs",
      ],
      { env, stdio: "inherit", windowsHide: true },
    );
    const [code] = await once(test, "exit");
    process.exitCode = code ?? 1;
    if (code === 0) {
      // Execute the actual bundled entry with only this owned disposable DB.
      // Disable provider delivery so synthetic secrets never contact Stripe.
      const worker = spawn(
        process.execPath,
        ["dist/payment-worker.cjs", "--once"],
        {
          env: { ...env, PAYMENTS_MODE: "disabled" },
          stdio: "inherit",
          windowsHide: true,
        },
      );
      const [workerCode] = await once(worker, "exit");
      assert.equal(
        workerCode,
        0,
        "Bundled maintenance worker must run successfully",
      );
      await mongo.stop();
      const ready = await fetch(`${env.APP_ORIGIN}/api/health/ready`, {
        signal: AbortSignal.timeout(6500),
      });
      assert.equal(ready.status, 503);
      assert.deepEqual(await ready.json(), {
        status: "unavailable",
        commit: env.RELEASE_COMMIT,
      });
      assert.equal(
        (await fetch(`${env.APP_ORIGIN}/api/health/live`)).status,
        200,
      );
      console.log(
        "Readiness fails safely after the owned database stops; liveness remains available.",
      );
    }
  }
} finally {
  difyKeys?.server.close();
  if (app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited;
  }
  await mongo.stop();
}
