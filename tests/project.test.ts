import assert from "node:assert/strict";
import { test } from "node:test";
import {
  project,
  projectSchema,
  namespace,
  moduleForPath,
} from "../src/lib/project";
import { rateConfig } from "../src/lib/config/rate-limits";
test("project manifests validate identities, dependencies and locale choices", () => {
  assert.equal(namespace("session"), "unitale-session");
  assert.equal(moduleForPath("/api/runs/example/uploads"), "runs");
  for (const changes of [
    { slug: "../escape" },
    { defaultLocale: "fa" },
    { modules: ["payments"] },
    { locales: ["ar"], defaultLocale: "en" },
  ])
    assert.equal(
      projectSchema.safeParse({ ...project, ...changes }).success,
      false,
    );
  assert.equal(
    projectSchema.safeParse({
      ...project,
      slug: "another-app",
      examples: false,
    }).success,
    true,
  );
});
test("Redis is required outside local mode and policies are bounded", () => {
  assert.equal(rateConfig({ APP_ENV: "local" }).url, null);
  for (const env of [
    { APP_ENV: "production" },
    { APP_ENV: "local", REDIS_URL: "redis://localhost:6379" },
    { RATE_LIMITS_JSON: '{"read":0}' },
  ])
    assert.throws(() => rateConfig(env), { code: "SERVICE_UNAVAILABLE" });
  assert.equal(
    rateConfig({
      APP_ENV: "local",
      REDIS_URL: "redis://default:synthetic@127.0.0.1:6379",
    }).policies.upload,
    10,
  );
});
