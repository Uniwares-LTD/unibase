import "server-only";
import Stripe from "stripe";
import { AppError } from "../auth-policy";
import { parseStripeConfig } from "../config/payments";
import { creditConfig, runtimeCreditConfig } from "./credit-config";
import { requireSession } from "./session";
import { database } from "./mongo";
import { getConfig } from "./config";
import {
  createPaymentOrder,
  leasePaymentOrder,
  releasePaymentOrder,
  attachCheckout,
} from "./store/payments";
import { ensureCheckout } from "./stripe-provider";

export function stripeSettings() {
  const config = parseStripeConfig(
    {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    },
    creditConfig().mode === "stripe",
  );
  if (!config)
    throw new AppError(
      "PAYMENTS_DISABLED",
      "Credit purchases are unavailable.",
      403,
    );
  return config;
}
export function stripeClient() {
  return new Stripe(stripeSettings().key, {
    timeout: 10000,
    maxNetworkRetries: 1,
  });
}
export async function startStripeCheckout(packId: string, key: string) {
  const config = await runtimeCreditConfig();
  if (config.mode !== "stripe")
    throw new AppError(
      "PAYMENTS_DISABLED",
      "Credit purchases are unavailable.",
      403,
    );
  const actor = await requireSession();
  const pack = config.packs.find((item) => item.id === packId);
  if (!pack)
    throw new AppError("PACK_NOT_FOUND", "Credit pack was not found.", 404);
  const db = database();
  const prior = await createPaymentOrder(
    db,
    { uid: actor.uid, authTime: actor.auth_time },
    key,
    pack,
    getConfig().server.origin,
  );
  const order = await leasePaymentOrder(db, prior._id);
  if (!order)
    throw new AppError(
      "PAYMENT_RETRY",
      "Checkout is being prepared. Please retry shortly.",
      409,
    );
  try {
    const checkout = await ensureCheckout(stripeClient(), order);
    await attachCheckout(db, order, checkout.id, checkout.url ?? undefined);
    if (!checkout.url || checkout.status !== "open")
      throw new AppError(
        "CHECKOUT_CLOSED",
        "This checkout has closed. Start a new purchase.",
        409,
      );
    return { orderId: order._id, url: checkout.url };
  } finally {
    await releasePaymentOrder(db, order);
  }
}
