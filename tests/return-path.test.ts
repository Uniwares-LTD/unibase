import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturnPath, signInPath } from "../src/lib/return-path";

test("sign-in resumes only same-origin page paths", () => {
  assert.equal(safeReturnPath("/runs/x?y=1#top"), "/runs/x?y=1#top");
  assert.equal(safeReturnPath("/files"), "/files");
  for (const value of [
    null,
    undefined,
    "",
    "files",
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "/a/..//evil.test",
    "/a/%2e%2e//evil.test",
    "/a/%2E%2E//evil.test",
    "/a/.%2e//evil.test",
    "/./..//evil.test",
    "/a/../api/auth/session",
    "https://evil.test/files",
    "javascript:alert(1)",
    "/api/auth/session",
    "/account",
    "/account?next=/files",
  ])
    assert.equal(safeReturnPath(value), undefined, String(value));
});

test("sign-in links carry an encoded return path or none", () => {
  assert.equal(signInPath("/admin/users"), "/account?next=%2Fadmin%2Fusers");
  assert.equal(signInPath("//evil.test"), "/account");
  assert.equal(signInPath(null), "/account");
});
