import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MongoMemoryServer } from "mongodb-memory-server";
import { prepareStandalone } from "./standalone.mjs";

// A synthetic service account checks availability only. Never fetch provider
// tokens or use configured production credentials/databases in this test.
mkdirSync("output/health-tests", { recursive: true });
const directory = mkdtempSync(path.resolve("output/health-tests/run-"));
const filename = path.join(directory, "firebase.json");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credential = {
  type: "service_account",
  project_id: "unitale-health-test",
  client_email: "health@unitale-health-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
writeFileSync(filename, JSON.stringify(credential));
const mongo = await MongoMemoryServer.create({
  binary: { downloadDir: path.resolve(".cache/mongodb-binaries") },
  instance: { ip: "127.0.0.1" },
});
const env = {
  ...process.env,
  NODE_ENV: "production",
  APP_ENV: "staging",
  APP_ORIGIN: "https://health.example.test",
  AUTH_MODE: "firebase",
  FIREBASE_PROJECT_ID: credential.project_id,
  FIREBASE_API_KEY: "synthetic-public-key",
  FIREBASE_APP_ID: "synthetic-public-app",
  GOOGLE_APPLICATION_CREDENTIALS: filename,
  MONGODB_URI: mongo.getUri(),
  MONGODB_DATABASE: "unitale_health_test",
  ANDROID_HOST: "",
  ANDROID_PACKAGE_NAME: "",
  ANDROID_SHA256_FINGERPRINTS: "",
  RELEASE_COMMIT: "a".repeat(40),
  HOSTNAME: "127.0.0.1",
  PORT: "3103",
};
delete env.FIREBASE_AUTH_EMULATOR_HOST;
const app = spawn(process.execPath, [prepareStandalone()], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
const origin = "http://127.0.0.1:3103";
async function check(status) {
  const response = await fetch(`${origin}/api/health/ready`, {
    signal: AbortSignal.timeout(6500),
  });
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: status === 200 ? "ready" : "unavailable",
    commit: env.RELEASE_COMMIT,
  });
  assert.equal((await fetch(`${origin}/api/health/live`)).status, 200);
}
try {
  let available = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null)
      throw new Error("Health test server exited before startup.");
    try {
      if (
        (
          await fetch(`${origin}/api/health/live`, {
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      ) {
        available = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(available, true);
  await check(200);
  writeFileSync(
    filename,
    JSON.stringify({ ...credential, project_id: "different-project" }),
  );
  await check(503);
  writeFileSync(
    filename,
    JSON.stringify({ ...credential, private_key: "secret-invalid-key-canary" }),
  );
  await check(503);
  unlinkSync(filename);
  await check(503);
  writeFileSync(filename, JSON.stringify(credential));
  await check(200);
  await mongo.stop();
  await check(503);
  console.log(
    "Live-mode readiness passed: synthetic credential availability, project/key rejection, missing file, recovery, bounded database failure and independent liveness.",
  );
} finally {
  if (app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited;
  }
  await mongo.stop();
  try {
    unlinkSync(filename);
  } catch {}
  rmdirSync(directory);
}
