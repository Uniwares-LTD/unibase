import assert from "node:assert/strict";
import { test } from "node:test";
import {
  project,
  projectSchema,
  namespace,
  moduleForPath,
} from "../src/lib/project";
import { rateConfig } from "../src/lib/config/rate-limits";
import { limits } from "../src/lib/limits";
test("project manifests validate identities, dependencies and locale choices", () => {
  assert.equal(namespace("session"), `${project.slug}-session`);
  assert.equal(moduleForPath("/api/runs/example/uploads"), "runs");
  for (const changes of [
    { slug: "../escape" },
    { defaultLocale: "fa" },
    { modules: ["payments"] },
    { locales: ["ar"], defaultLocale: "en" },
    { limits: { runImages: 0 } },
    { limits: { artifactTextChars: 1_000_000 } },
    { limits: { unknown: 1 } },
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
      limits: { artifactTextChars: 40_000, runImages: 24 },
    }).success,
    true,
  );
  // The template manifest keeps the default content limits.
  assert.deepEqual(limits, { artifactTextChars: 8000, runImages: 10 });
  assert.equal(moduleForPath("/api/files/uploads/example/parts/0"), "files");
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
