import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStripeConfig,
  proportionalCredits,
} from "../src/lib/config/payments";
import { parseCreditConfig } from "../src/lib/config/credits";
import { paymentContext } from "../src/lib/payment-context";

test("refunds use exact cumulative whole-credit rounding even beyond floating multiplication precision", () => {
  assert.equal(proportionalCredits(100, 1, 3), 33);
  assert.equal(proportionalCredits(100, 2, 3), 66);
  assert.equal(proportionalCredits(100, 3, 3), 100);
  const max = Number.MAX_SAFE_INTEGER;
  assert.equal(proportionalCredits(max, max - 1, max), max - 1);
  for (const input of [
    [100, 4, 3],
    [100, -1, 3],
    [100, 1, 0],
    [1.5, 1, 3],
  ])
    assert.throws(() =>
      proportionalCredits(...(input as [number, number, number])),
    );
});
test("Play context has no web-payment fallback when its billing service fails", async () => {
  const broken = async () => {
    throw new Error("unavailable");
  };
  assert.equal(
    await paymentContext({
      referrer: "android-app://fixture",
      search: "",
      markedPlay: false,
      digitalGoods: broken,
    }),
    "play",
  );
  assert.equal(
    await paymentContext({
      referrer: "",
      search: "?client=play",
      markedPlay: false,
      digitalGoods: broken,
    }),
    "play",
  );
  assert.equal(
    await paymentContext({ referrer: "", search: "", markedPlay: true }),
    "play",
  );
  assert.equal(
    await paymentContext({
      referrer: "",
      search: "",
      markedPlay: false,
      digitalGoods: async () => ({}),
    }),
    "play",
  );
  assert.equal(
    await paymentContext({
      referrer: "",
      search: "",
      markedPlay: false,
      digitalGoods: broken,
    }),
    "web",
  );
});
test("Stripe activation requires explicit secrets and complete server catalog terms", () => {
  assert.equal(parseStripeConfig({}, false), null);
  assert.throws(
    () => parseStripeConfig({ STRIPE_SECRET_KEY: "secret-value" }, true),
    (error) =>
      error instanceof Error && !error.message.includes("secret-value"),
  );
  assert.equal(
    parseStripeConfig(
      {
        STRIPE_SECRET_KEY: "sk_test_fixture",
        STRIPE_WEBHOOK_SECRET: "whsec_fixture",
      },
      true,
    )?.key,
    "sk_test_fixture",
  );
  const pack = {
    id: "fixture",
    label: "Fixture",
    credits: 100,
    stripePriceId: "price_fixture",
    amountMinor: 500,
    currency: "usd",
  };
  assert.equal(
    parseCreditConfig(
      { PAYMENTS_MODE: "stripe", CREDIT_PACKS_JSON: JSON.stringify([pack]) },
      "local",
      "emulator",
    ).packs[0].amountMinor,
    500,
  );
  assert.throws(() =>
    parseCreditConfig(
      {
        PAYMENTS_MODE: "stripe",
        CREDIT_PACKS_JSON: JSON.stringify([{ ...pack, currency: undefined }]),
      },
      "local",
      "emulator",
    ),
  );
});
