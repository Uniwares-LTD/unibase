import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

test("tracked local defaults yield to private overrides and reject tracked credentials", async () => {
  await mkdir(".cache/local-environment-tests", { recursive: true });
  const root = await mkdtemp(
    path.resolve(".cache/local-environment-tests/fixture-"),
  );
  await mkdir(path.join(root, "scripts/deploy"), { recursive: true });
  await mkdir(path.join(root, "deploy/environments"), { recursive: true });
  await writeFile(
    path.join(root, "scripts/environment.mjs"),
    await readFile("scripts/environment.mjs"),
  );
  await writeFile(
    path.join(root, "scripts/deploy/environment-catalog.json"),
    await readFile("scripts/deploy/environment-catalog.json"),
  );
  const config = JSON.parse(
    await readFile("deploy/environments/local.json", "utf8"),
  );
  config.runtime.APP_NAME = "Tracked name";
  const file = path.join(root, "deploy/environments/local.json");
  await writeFile(file, JSON.stringify(config));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "local",
    NODE_ENV: "development",
  };
  delete env.APP_NAME;
  delete env.APP_STYLE;
  delete env.MONGODB_DATABASE;
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {loadLocalEnvironment} from './scripts/environment.mjs'; loadLocalEnvironment(true); console.log(JSON.stringify({name:process.env.APP_NAME,style:process.env.APP_STYLE}));",
      ],
      {
        cwd: root,
        env,
        encoding: "utf8",
        windowsHide: true,
      },
    );
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)!), {
    name: "Tracked name",
    style: "classic",
  });
  await writeFile(path.join(root, ".env.local"), "APP_NAME=Private override\n");
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout.trim().split("\n").at(-1)!).name,
    "Private override",
  );
  config.runtime.STRIPE_SECRET_KEY = "secret-canary";
  await writeFile(file, JSON.stringify(config));
  result = run();
  assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes("secret-canary"));
});
