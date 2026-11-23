import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dataOperationSchema } from "../src/lib/contracts/data-operations";
test("Infrastructure report fixture obeys the strict shared DTO and matches its mirror", () => {
  const bytes = readFileSync(
    "tests/fixtures/data-operation-report.json",
    "utf8",
  );
  assert.equal(
    bytes,
    readFileSync(
      "../infrastructure/tests/fixtures/data-operation-report.json",
      "utf8",
    ),
  );
  const fixture = JSON.parse(bytes);
  assert.equal(dataOperationSchema.parse(fixture).state, "completed");
  assert.equal(
    dataOperationSchema.safeParse({ ...fixture, mongoUri: "canary" }).success,
    false,
  );
  assert.equal(
    dataOperationSchema.safeParse({
      ...fixture,
      backup: { ...fixture.backup, verified: false },
    }).success,
    false,
  );
  assert.equal(
    dataOperationSchema.safeParse({ ...fixture, verification: [] }).success,
    false,
  );
});
