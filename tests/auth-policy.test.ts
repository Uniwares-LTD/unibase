import assert from "node:assert/strict";
import { test } from "node:test";
import { requireRecentLogin, requireSameOrigin } from "../src/lib/auth-policy";
import { parseAuthConfig } from "../src/lib/config/auth";
import { profileUpdateSchema } from "../src/lib/contracts/profile";

test("session exchange requires recent authentication and issuance", () => {
  requireRecentLogin({ auth_time: 900, iat: 999 }, 1000);
  for (const claims of [
    { auth_time: 699, iat: 999 },
    { auth_time: 999, iat: 699 },
    { auth_time: 1100, iat: 999 },
    { auth_time: NaN, iat: 999 },
  ])
    assert.throws(() => requireRecentLogin(claims, 1000));
});
test("session mutations reject absent, foreign and sibling origins", () => {
  requireSameOrigin(
    new Headers({
      origin: "https://unitale.example",
      "sec-fetch-site": "same-origin",
    }),
    "https://unitale.example",
  );
  for (const origin of [
    null,
    "https://evil.example",
    "null",
    "https://sibling.unitale.example",
  ]) {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    assert.throws(() => requireSameOrigin(headers, "https://unitale.example"));
  }
});
test("profile updates cannot submit ownership or private fields", () => {
  assert.equal(
    profileUpdateSchema.safeParse({ displayName: "Alice", theme: "dark" })
      .success,
    true,
  );
  for (const key of ["uid", "email", "password", "idToken", "$set"])
    assert.equal(
      profileUpdateSchema.safeParse({
        displayName: "Alice",
        theme: "dark",
        [key]: "attacker",
      }).success,
      false,
    );
});
test("emulator configuration cannot be enabled outside a local demo project", () => {
  const config = parseAuthConfig({}, "local", "http://localhost:3000");
  assert.equal(config.public.projectId, "demo-unitale");
  assert.ok(!("mongoUri" in config.public));
  assert.throws(() =>
    parseAuthConfig(
      { AUTH_MODE: "emulator" },
      "production",
      "https://unitale.example",
    ),
  );
  assert.throws(() =>
    parseAuthConfig(
      { FIREBASE_PROJECT_ID: "real-project" },
      "local",
      "http://localhost:3000",
    ),
  );
});
