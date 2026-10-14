import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { parseAuthConfig } from "../src/lib/config/auth";
import { databasePrefix } from "../src/lib/project";

test("database defaults remain local-only and explicit settings win", () => {
  assert.deepEqual(parseDatabaseConfig({}, "local"), {
    mongoUri: "mongodb://127.0.0.1:27017",
    database: `${databasePrefix}_local`,
  });
  const configured = {
    MONGODB_URI: "mongodb+srv://fixture.example.test",
    MONGODB_DATABASE: "fixture_db",
  };
  for (const environment of ["local", "staging", "production"])
    assert.deepEqual(parseDatabaseConfig(configured, environment), {
      mongoUri: configured.MONGODB_URI,
      database: configured.MONGODB_DATABASE,
    });
  for (const environment of ["staging", "production"])
    assert.throws(
      () => parseDatabaseConfig({}, environment),
      /MONGODB_URI.*MONGODB_DATABASE/,
    );
});

test("database validation reports only field names, never supplied values", () => {
  for (const input of [
    {
      MONGODB_URI: "https://private-value.example.test",
      MONGODB_DATABASE: "safe",
    },
    {
      MONGODB_URI: "mongodb://fixture.example.test",
      MONGODB_DATABASE: "private/value",
    },
    { MONGODB_URI: "", MONGODB_DATABASE: "" },
  ]) {
    assert.throws(
      () => parseDatabaseConfig(input, "local"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid database configuration: MONGODB_/);
        assert.ok(!error.message.includes("private"));
        assert.ok(!error.message.includes("fixture.example"));
        return true;
      },
    );
  }
});

test("database and authentication configuration are independent", () => {
  const database = parseDatabaseConfig({ AUTH_MODE: "invalid" }, "local");
  assert.equal(database.database, `${databasePrefix}_local`);
  const auth = parseAuthConfig(
    {
      AUTH_MODE: "firebase",
      FIREBASE_PROJECT_ID: "fixture-project",
      FIREBASE_API_KEY: "fixture-key",
      FIREBASE_APP_ID: "fixture-app",
      MONGODB_URI: "invalid",
    },
    "production",
    "https://unibase.example",
  );
  assert.equal(auth.server.mode, "firebase");
  assert.ok(!("mongoUri" in auth.server));
  assert.ok(!("database" in auth.public));
});
