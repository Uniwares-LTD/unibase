/* eslint-disable @typescript-eslint/no-require-imports -- Node's --require preload must be CommonJS. */
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { applyRuntimeSettings } = require("./runtime-settings.cjs");

// Preloaded by Node in the release image, before either the web server or workers.
applyRuntimeSettings(
  JSON.parse(readFileSync(join(__dirname, "runtime-settings.json"), "utf8")),
  process.env,
);
