import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const {
  applyRuntimeSettings,
  selectRuntimeSettings,
} = require("../scripts/runtime-settings.cjs");
const settings = {
  local: { DIAGNOSTICS_ENABLED: "false" },
  staging: { DIAGNOSTICS_ENABLED: "true" },
  production: { DIAGNOSTICS_ENABLED: "false" },
};

test("image settings override stale flags and preserve all private bindings", () => {
  const env = {
    APP_ENV: "staging",
    DIAGNOSTICS_ENABLED: "false",
    MONGODB_URI: "private-canary",
  };
  applyRuntimeSettings(settings, env);
  assert.equal(env.DIAGNOSTICS_ENABLED, "true");
  assert.equal(env.MONGODB_URI, "private-canary");
  applyRuntimeSettings(
    { ...settings, staging: { DIAGNOSTICS_ENABLED: "false" } },
    env,
  );
  assert.equal(env.DIAGNOSTICS_ENABLED, "false");
});

test("invalid or private image settings and production enablement fail closed", () => {
  for (const value of [true, null, "TRUE", "true\nINJECT=x"]) {
    assert.throws(() =>
      selectRuntimeSettings(
        { ...settings, staging: { DIAGNOSTICS_ENABLED: value } },
        "staging",
      ),
    );
  }
  assert.throws(() =>
    selectRuntimeSettings(
      {
        ...settings,
        staging: { DIAGNOSTICS_ENABLED: "true", REDIS_URL: "secret" },
      },
      "staging",
    ),
  );
  assert.throws(() =>
    selectRuntimeSettings(
      { ...settings, production: { DIAGNOSTICS_ENABLED: "true" } },
      "production",
    ),
  );
  assert.throws(() =>
    applyRuntimeSettings(settings, {
      APP_ENV: "production",
      DIAGNOSTICS_ENABLED: "true",
    }),
  );
  assert.throws(() => selectRuntimeSettings(settings, "unknown"));
});

test("build output projects only application flags and preload runs before node entrypoints", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "runtime-settings-"));
  try {
    await mkdir(path.join(root, "deploy/environments"), { recursive: true });
    for (const [environment, values] of Object.entries(settings)) {
      await writeFile(
        path.join(root, "deploy/environments", environment + ".json"),
        JSON.stringify({
          environment,
          runtime: {
            APP_ENV: environment,
            ...values,
            PRIVATE_CANARY: "must-not-ship",
          },
        }),
      );
    }
    const { writeRuntimeSettings } =
      await import("../scripts/build-runtime-settings.mjs");
    await writeRuntimeSettings(root);
    const output = await readFile(
      path.join(root, "dist/runtime-settings.json"),
      "utf8",
    );
    assert.deepEqual(JSON.parse(output), settings);
    assert.equal(output.includes("must-not-ship"), false);
    await cp(
      path.join(root, "dist/runtime-settings.json"),
      path.join(root, "runtime-settings.json"),
    );
    for (const name of ["runtime-settings.cjs", "load-runtime-settings.cjs"])
      await cp(
        new URL("../scripts/" + name, import.meta.url),
        path.join(root, name),
      );
    for (const environment of ["local", "staging", "production"] as const) {
      const result = spawnSync(
        process.execPath,
        [
          "--require",
          path.join(root, "load-runtime-settings.cjs"),
          "-e",
          "process.stdout.write(process.env.DIAGNOSTICS_ENABLED)",
        ],
        {
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            NODE_ENV: "test",
            APP_ENV: environment,
            DIAGNOSTICS_ENABLED: "false",
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, settings[environment].DIAGNOSTICS_ENABLED);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
