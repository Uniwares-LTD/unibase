import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

const root = path.resolve(".");
mkdirSync("output/start-tests", { recursive: true });
const directory = mkdtempSync(path.resolve("output/start-tests/run-"));
const canary = `Unibase startup ${randomUUID()}`;
// Only build/assets are shared. This fixture owns its env file, never the user's.
symlinkSync(
  path.join(root, ".next"),
  path.join(directory, ".next"),
  "junction",
);
cpSync(path.join(root, "public"), path.join(directory, "public"), {
  recursive: true,
});
writeFileSync(
  path.join(directory, ".env.local"),
  `APP_NAME=${canary}\nAPP_ENV=local\nAPP_ORIGIN=http://127.0.0.1:3104\n`,
);
const env = {
  ...process.env,
  PORT: "3104",
  HOSTNAME: "127.0.0.1",
  NODE_ENV: "production",
};
for (const key of [
  "APP_NAME",
  "APP_ENV",
  "APP_ORIGIN",
  "AUTH_MODE",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_API_KEY",
  "FIREBASE_APP_ID",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "MONGODB_URI",
  "MONGODB_DATABASE",
  "ANDROID_PACKAGE_NAME",
  "ANDROID_SHA256_FINGERPRINTS",
])
  delete env[key];
const app = spawn(process.execPath, [path.join(root, "scripts/start.mjs")], {
  cwd: directory,
  env,
  stdio: "inherit",
  windowsHide: true,
});
try {
  let body;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (app.exitCode !== null) throw new Error("Startup fixture exited.");
    try {
      const response = await fetch("http://127.0.0.1:3104/", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        body = await response.text();
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(body?.includes(canary));
  console.log("Local standalone startup loads its owned env file at runtime.");
} finally {
  if (app.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(app.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else app.kill();
    await exited;
  }
  for (const file of [".next", ".env.local"])
    unlinkSync(path.join(directory, file));
  const copiedAssets = path.resolve(directory, "public");
  assert.ok(
    copiedAssets.startsWith(path.resolve("output/start-tests") + path.sep),
  );
  rmSync(copiedAssets, { recursive: true, force: true });
  rmdirSync(directory);
}
