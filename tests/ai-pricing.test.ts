import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateAiCharge } from "../src/lib/ai-pricing";
import { aiPricingSchema, type AiPricing } from "../src/lib/config/ai-pricing";

const usage = {
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
  cost: { amount: "0.0025", currency: "USD", source: "provider" as const },
};
test("billing terms reject invalid bounds and rates", () => {
  for (const terms of [
    { mode: "fixed", credits: -1 },
    {
      mode: "provider-cost",
      maxCredits: 1,
      currency: "USD",
      creditsPerCurrencyUnit: 3,
    },
    {
      mode: "tokens",
      maxCredits: 0,
      rate: { basis: "total", creditsPerMillion: "1" },
    },
    {
      mode: "hybrid",
      maxCredits: 1,
      baseCredits: 2,
      usage: {
        mode: "tokens",
        rate: { basis: "total", creditsPerMillion: "1" },
      },
    },
  ])
    assert.equal(aiPricingSchema.safeParse(terms).success, false);
});
test("fixed, token, provider-cost and hybrid prices round exactly once and cap charges", () => {
  const cases: [AiPricing, number][] = [
    [{ mode: "fixed", credits: 2 }, 2],
    [
      {
        mode: "tokens",
        maxCredits: 20,
        rate: { basis: "total", creditsPerMillion: "1000" },
      },
      2,
    ],
    [
      {
        mode: "tokens",
        maxCredits: 20,
        rate: {
          basis: "split",
          inputCreditsPerMillion: "200",
          outputCreditsPerMillion: "400",
        },
      },
      1,
    ],
    [
      {
        mode: "provider-cost",
        maxCredits: 20,
        currency: "USD",
        creditsPerCurrencyUnit: "400",
      },
      1,
    ],
    [
      {
        mode: "hybrid",
        maxCredits: 20,
        baseCredits: 2,
        usage: {
          mode: "provider-cost",
          currency: "USD",
          creditsPerCurrencyUnit: "400",
        },
      },
      3,
    ],
  ];
  for (const [price, expected] of cases)
    assert.equal(calculateAiCharge(price, usage)?.credits, expected);
  const capped = calculateAiCharge(
    {
      mode: "tokens",
      maxCredits: 2,
      rate: { basis: "total", creditsPerMillion: "1000000" },
    },
    usage,
  );
  assert.deepEqual(capped, {
    credits: 2,
    calculatedCredits: "1500",
    capped: true,
  });
  assert.equal(
    calculateAiCharge(
      {
        mode: "provider-cost",
        maxCredits: 20,
        currency: "USD",
        creditsPerCurrencyUnit: "10",
      },
      { ...usage, cost: { ...usage.cost, amount: "0.100000000000000001" } },
    )?.credits,
    2,
  );
});
test("unknown usage or currency mismatches cannot become zero-cost or estimated charges", () => {
  const price: AiPricing = {
    mode: "provider-cost",
    maxCredits: 10,
    currency: "USD",
    creditsPerCurrencyUnit: "400",
  };
  assert.equal(calculateAiCharge(price, null), null);
  assert.equal(
    calculateAiCharge(price, {
      ...usage,
      cost: { ...usage.cost, currency: "EUR" },
    }),
    null,
  );
  assert.equal(
    calculateAiCharge(price, { ...usage, cost: { ...usage.cost, amount: "0" } })
      ?.credits,
    0,
  );
  assert.equal(
    calculateAiCharge(
      {
        mode: "tokens",
        maxCredits: 10,
        rate: {
          basis: "split",
          inputCreditsPerMillion: "1",
          outputCreditsPerMillion: "1",
        },
      },
      { ...usage, inputTokens: null },
    ),
    null,
  );
  assert.equal(
    calculateAiCharge({ mode: "fixed", credits: 0 }, null)?.credits,
    0,
  );
});
