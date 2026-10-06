import assert from "node:assert/strict";
import { test } from "node:test";
import { redirectUser } from "../src/lib/client/redirect-state";
import { parseAuthConfig } from "../src/lib/config/auth";

const google = { providerData: [{ providerId: "google.com" }] };
test("redirect completion recovers a Google user already restored by Firebase", () => {
  assert.equal(redirectUser(null, google, "1000", 2000), google);
  assert.equal(redirectUser(google, null, null, 2000), google);
});
test("visiting sign-in cannot revive stale or unrelated SDK state", () => {
  for (const started of [null, "bad", "0", "3000"])
    assert.equal(redirectUser(null, google, started, 700000), null);
  assert.equal(redirectUser(null, google, "3000", 2000), null);
  assert.equal(
    redirectUser(
      null,
      { providerData: [{ providerId: "password" }] },
      "1000",
      2000,
    ),
    null,
  );
  assert.equal(redirectUser(null, null, "1000", 2000), null);
});
test("local browser emulator uses the app hostname while Admin keeps its configured endpoint", () => {
  const config = parseAuthConfig({}, "local", "http://localhost:3000");
  assert.equal(config.public.emulatorUrl, "http://localhost:9099");
  assert.equal(config.server.emulatorHost, "127.0.0.1:9099");
  assert.equal(
    parseAuthConfig({}, "local", "http://127.0.0.1:3000").public.emulatorUrl,
    "http://127.0.0.1:9099",
  );
});
