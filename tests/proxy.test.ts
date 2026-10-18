import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

test("document CSP follows only local loopback emulator ports and excludes untrusted origins", () => {
  const previousEnvironment = process.env.APP_ENV;
  const previousHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const policy = () =>
    proxy(new NextRequest("http://localhost:3000/"))!.headers.get(
      "content-security-policy",
    )!;
  try {
    process.env.APP_ENV = "local";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199";
    assert.match(policy(), /http:\/\/127\.0\.0\.1:9199/);
    assert.match(policy(), /http:\/\/localhost:9199/);
    assert.doesNotMatch(policy(), /:9099/);
    for (const host of [
      "localhost:9199 https://untrusted.example",
      "remote.example:9199",
      "localhost:99999",
    ]) {
      process.env.FIREBASE_AUTH_EMULATOR_HOST = host;
      assert.doesNotMatch(
        policy(),
        /untrusted|remote\.example|http:\/\/localhost:/,
      );
    }
    process.env.APP_ENV = "production";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9199";
    assert.doesNotMatch(policy(), /localhost|127\.0\.0\.1/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previousEnvironment;
    if (previousHost === undefined)
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = previousHost;
  }
});
