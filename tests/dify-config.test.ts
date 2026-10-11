import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDifyConfig } from "../src/lib/config/dify";

const configured = {
  DIFY_MODE: "live",
  DIFY_BASE_URL: "https://dify.example.test/v1",
  DIFY_ORCHESTRATORS_JSON: JSON.stringify([
    {
      id: "summarize",
      name: "Summarize",
      description: "",
      order: 0,
      enabled: true,
      keyEnv: "DIFY_KEY_SUMMARIZE",
      inputs: [],
      pricing: null,
      recovery: null,
    },
  ]),
  DIFY_KEY_SUMMARIZE: "private-canary",
};

test("Dify is disabled without credentials and fake mode is independent", () => {
  assert.deepEqual(parseDifyConfig({}), { mode: "disabled" });
  assert.deepEqual(
    parseDifyConfig({ DIFY_MODE: "fake", DIFY_BASE_URL: "invalid" }),
    { mode: "fake" },
  );
});

test("Dify resolves only named private bindings and validates the API base URL", () => {
  const parsed = parseDifyConfig(configured);
  assert.equal(parsed.mode, "live");
  if (parsed.mode !== "live") return;
  assert.equal(parsed.bindings[0].apiKey, "private-canary");
  for (const DIFY_BASE_URL of [
    "http://dify.example.test/v1",
    "https://user:secret@dify.example.test/v1",
    "https://dify.example.test/v1?key=private-canary",
    "https://dify.example.test/",
  ]) {
    assert.throws(
      () => parseDifyConfig({ ...configured, DIFY_BASE_URL }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes("private-canary"));
        assert.ok(!error.message.includes("secret@"));
        return true;
      },
    );
  }
  assert.equal(
    parseDifyConfig({
      ...configured,
      DIFY_BASE_URL: "http://127.0.0.1:5001/v1",
    }).mode,
    "live",
  );
  assert.throws(() =>
    parseDifyConfig({
      ...configured,
      APP_ENV: "production",
      DIFY_BASE_URL: "http://127.0.0.1:5001/v1",
    }),
  );
});

test("Dify rejects duplicate capability names and missing private credentials", () => {
  assert.deepEqual(
    (
      parseDifyConfig({ ...configured, DIFY_KEY_SUMMARIZE: undefined }) as {
        bindings: unknown[];
      }
    ).bindings,
    [],
  );
  const binding: unknown = JSON.parse(configured.DIFY_ORCHESTRATORS_JSON)[0];
  assert.throws(() =>
    parseDifyConfig({
      ...configured,
      DIFY_ORCHESTRATORS_JSON: JSON.stringify([binding, binding]),
    }),
  );
  assert.throws(
    () => parseDifyConfig({ DIFY_MODE: "unexpected-secret" }),
    /Invalid DIFY_MODE/,
  );
});
