import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminChangeSchema,
  adminProfileSchema,
} from "../src/lib/contracts/admin";
import { adjustmentSchema } from "../src/lib/contracts/credits";
import { aiResolutionSchema } from "../src/lib/contracts/ai";
import {
  cleanupExecuteSchema,
  paymentReviewSchema,
} from "../src/lib/contracts/operations";
import { personaChangeSchema } from "../src/lib/contracts/personas";
import { settingsUpdateSchema } from "../src/lib/contracts/settings";

test("administrative reasons accept omission, blank and short notes while retaining bounds", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const cases = [
    [
      adminChangeSchema,
      { targetUid: "member", role: "member", status: "active" },
      300,
    ],
    [adminProfileSchema, { targetUid: "member", displayName: "Member" }, 300],
    [
      adjustmentSchema,
      { targetUid: "member", key: "adjust", amount: 1, direction: "grant" },
      300,
    ],
    [
      aiResolutionSchema,
      { decision: "release", acknowledgeProviderMayStillRun: true },
      500,
    ],
    [cleanupExecuteSchema, { reportId: id, confirm: true }, 500],
    [paymentReviewSchema, { key: id, orderId: "a".repeat(64) }, 500],
    [
      personaChangeSchema,
      {
        id,
        revision: 0,
        fields: {
          name: "Parent",
          description: "",
          instructions: "Answer as a parent.",
          responderId: null,
          enabled: false,
          archived: false,
        },
      },
      500,
    ],
    [settingsUpdateSchema.pick({ reason: true }), {}, 300],
  ] as const;
  for (const [schema, fields, limit] of cases) {
    assert.equal(schema.parse(fields).reason, "");
    assert.equal(schema.parse({ ...fields, reason: "  " }).reason, "");
    assert.equal(schema.parse({ ...fields, reason: " OK " }).reason, "OK");
    assert.equal(
      schema.safeParse({ ...fields, reason: "x".repeat(limit + 1) }).success,
      false,
    );
    assert.equal(schema.safeParse({ ...fields, reason: 42 }).success, false);
  }
  assert.equal(cleanupExecuteSchema.safeParse({ reportId: id }).success, false);
  assert.equal(
    aiResolutionSchema.safeParse({ decision: "release" }).success,
    false,
  );
});
