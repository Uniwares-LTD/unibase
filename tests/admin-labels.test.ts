import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminStateLabel,
  adminFieldLabel,
  formatAdminNumber,
} from "../src/lib/admin-labels";

test("English administrative labels retain unknown identifiers as inert text", () => {
  assert.equal(adminStateLabel("admin"), "Administrator");
  assert.equal(adminFieldLabel("appName"), "App name");
  assert.equal(formatAdminNumber(12345), "12,345");
  assert.equal(adminStateLabel(null), "—");
  for (const value of ["constructor", "__proto__", "custom-provider-state"]) {
    assert.equal(adminStateLabel(value), value);
    assert.equal(adminFieldLabel(value), value);
  }
});
