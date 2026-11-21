import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleToastExpiry } from "../src/lib/toast-timing";

test("a confirmation restarts its full duration after a pause", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expire = t.mock.fn();
  const cancel = scheduleToastExpiry(false, expire);
  t.mock.timers.tick(5999);
  assert.equal(expire.mock.callCount(), 0);
  cancel?.();
  scheduleToastExpiry(true, expire);
  t.mock.timers.tick(6000);
  assert.equal(expire.mock.callCount(), 0);
  scheduleToastExpiry(false, expire);
  t.mock.timers.tick(5999);
  assert.equal(expire.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(expire.mock.callCount(), 1);
});
