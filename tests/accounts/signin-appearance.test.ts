import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import { signinAppearance } from "../../src/lib/server/store/signin-appearance";
import { sessionResultSchema } from "../../src/lib/contracts/profile";

function databaseReturning(value: unknown, failure?: Error) {
  return {
    collection(name: string) {
      assert.equal(name, "profiles");
      return {
        async findOne(filter: unknown, options: unknown) {
          assert.deepEqual(filter, { uid: "verified-owner" });
          assert.deepEqual(options, {
            projection: { _id: 0, theme: 1, style: 1 },
            timeoutMS: 1000,
          });
          if (failure) throw failure;
          return value;
        },
      };
    },
  } as unknown as Db;
}

test("sign-in returns only saved appearance for the verified owner", async () => {
  const appearance = await signinAppearance(
    databaseReturning({ theme: "dark", style: "glass" }),
    "verified-owner",
  );
  assert.deepEqual(sessionResultSchema.parse({ verified: true, appearance }), {
    verified: true,
    appearance: { theme: "dark", style: "glass" },
  });
});

test("legacy appearance preserves theme and inherits the default style", async () => {
  assert.deepEqual(
    await signinAppearance(
      databaseReturning({ theme: "light" }),
      "verified-owner",
    ),
    { theme: "light", style: "default" },
  );
});

test("missing, invalid and unavailable preferences do not fail sign-in", async () => {
  for (const value of [null, {}, { theme: "invalid", style: "glass" }]) {
    assert.equal(
      await signinAppearance(databaseReturning(value), "verified-owner"),
      undefined,
    );
  }
  assert.equal(
    await signinAppearance(
      databaseReturning(null, new Error("operation timed out")),
      "verified-owner",
    ),
    undefined,
  );
  assert.deepEqual(sessionResultSchema.parse({ verified: true }), {
    verified: true,
  });
});
