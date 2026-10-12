import "server-only";
import { z } from "zod";
import type { RegisteredTool } from "./tools";

const itemId = z.enum(["telescope", "star-map", "notebook"]);
const category = z.enum(["equipment", "guides"]);
const items = [
  {
    id: "telescope",
    name: "Pocket telescope",
    category: "equipment",
    priceMinor: 4500,
    description: "A fictional portable telescope for the demo observatory.",
  },
  {
    id: "star-map",
    name: "Star map",
    category: "guides",
    priceMinor: 1200,
    description: "A synthetic map for a guided stargazing session.",
  },
  {
    id: "notebook",
    name: "Observer notebook",
    category: "guides",
    priceMinor: 800,
    description: "A fictional notebook for recording observations.",
  },
];

// Deterministic public examples: no user identity, orders, payments or writes.
export const demoScenarioTools: readonly RegisteredTool[] = [
  {
    name: "get_demo_catalog_v1",
    description:
      "Read a small synthetic product catalog, optionally filtered by category. Contains no private data.",
    permission: "demo:read",
    input: z.strictObject({ category: z.enum(["all", "equipment", "guides"]) }),
    output: z.strictObject({
      currency: z.literal("USD"),
      items: z
        .array(
          z.strictObject({
            id: itemId,
            name: z.string(),
            category,
            priceMinor: z.number().int().nonnegative(),
            description: z.string(),
          }),
        )
        .max(3),
      requestId: z.string().uuid(),
    }),
    async run(input, context) {
      context.signal.throwIfAborted();
      return {
        currency: "USD",
        items: items
          .filter(
            (item) =>
              input.category === "all" || item.category === input.category,
          )
          .map((item) => ({ ...item })),
        requestId: context.requestId,
      };
    },
  },
  {
    name: "calculate_demo_quote_v1",
    description:
      "Calculate a synthetic quote in USD minor units. Does not create an order, reserve inventory, save user data or charge money.",
    permission: "demo:read",
    input: z.strictObject({
      itemId,
      quantity: z.number().int().min(1).max(20),
      delivery: z.enum(["standard", "express"]),
    }),
    output: z.strictObject({
      itemId,
      quantity: z.number().int().min(1).max(20),
      currency: z.literal("USD"),
      subtotalMinor: z.number().int().nonnegative(),
      deliveryMinor: z.number().int().nonnegative(),
      totalMinor: z.number().int().nonnegative(),
      requestId: z.string().uuid(),
    }),
    async run(input, context) {
      context.signal.throwIfAborted();
      const item = items.find((item) => item.id === input.itemId);
      if (!item) throw new Error("Unknown demo item");
      const quantity = input.quantity as number;
      const subtotalMinor = item.priceMinor * quantity;
      const deliveryMinor = input.delivery === "express" ? 1500 : 500;
      return {
        itemId: item.id,
        quantity,
        currency: "USD",
        subtotalMinor,
        deliveryMinor,
        totalMinor: subtotalMinor + deliveryMinor,
        requestId: context.requestId,
      };
    },
  },
];
