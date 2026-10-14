import "server-only";
import { namespace } from "../project";
import type Stripe from "stripe";
import { AppError } from "../auth-policy";
import type { PaymentOrder, PaymentNotice } from "./store/payments";

const mismatch = () =>
  new AppError(
    "PAYMENT_TERMS_MISMATCH",
    "Verified payment terms do not match this order.",
    409,
  );
const id = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;
export async function ensureCheckout(stripe: Stripe, order: PaymentOrder) {
  if (order.sessionId)
    return stripe.checkout.sessions.retrieve(order.sessionId);
  // Stripe only retains request idempotency for at least 24h. Do not recreate
  // an unknown old request after that window; reconciliation recovers its result.
  if (Date.now() - order.createdAt.getTime() > 23 * 3600000)
    throw new AppError(
      "CHECKOUT_CLOSED",
      "Start a new purchase with a new request key.",
      409,
    );
  const price = await stripe.prices.retrieve(order.priceId);
  if (
    !price.active ||
    price.type !== "one_time" ||
    price.unit_amount !== order.amountMinor ||
    price.currency !== order.currency ||
    price.billing_scheme !== "per_unit"
  )
    throw mismatch();
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: [{ price: order.priceId, quantity: 1 }],
      client_reference_id: order._id,
      metadata: { unibaseOrder: order._id },
      payment_intent_data: { metadata: { unibaseOrder: order._id } },
      success_url: `${order.origin}/credits?checkout=returned`,
      cancel_url: `${order.origin}/credits?checkout=cancelled`,
      expires_at: Math.floor(order.createdAt.getTime() / 1000) + 24 * 3600,
    },
    { idempotencyKey: `${namespace("checkout")}-${order._id}` },
  );
}
export async function verifiedStripeState(stripe: Stripe, order: PaymentOrder) {
  if (!order.sessionId)
    throw new AppError(
      "PAYMENT_PENDING",
      "Checkout is awaiting recovery.",
      409,
    );
  const checkout = await stripe.checkout.sessions.retrieve(order.sessionId);
  const lines = await stripe.checkout.sessions.listLineItems(checkout.id, {
    limit: 2,
  });
  if (
    checkout.mode !== "payment" ||
    checkout.client_reference_id !== order._id ||
    checkout.metadata?.unibaseOrder !== order._id ||
    checkout.amount_total !== order.amountMinor ||
    checkout.currency !== order.currency ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    id(lines.data[0].price) !== order.priceId
  )
    throw mismatch();
  if (checkout.payment_status !== "paid")
    return {
      paid: false,
      expired: checkout.status === "expired",
      refundedMinor: 0,
      disputed: false,
    };
  const piId = id(checkout.payment_intent);
  if (!piId) throw mismatch();
  const pi = await stripe.paymentIntents.retrieve(piId);
  const chargeId = id(pi.latest_charge);
  if (
    pi.metadata.unibaseOrder !== order._id ||
    pi.status !== "succeeded" ||
    pi.amount_received !== order.amountMinor ||
    pi.currency !== order.currency ||
    !chargeId
  )
    throw mismatch();
  const charge = await stripe.charges.retrieve(chargeId);
  if (
    !charge.paid ||
    !charge.captured ||
    charge.amount !== order.amountMinor ||
    charge.currency !== order.currency ||
    id(charge.payment_intent) !== pi.id
  )
    throw mismatch();
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  if (refunds.has_more) throw mismatch();
  let refundedMinor = 0;
  for (const refund of refunds.data) {
    if (refund.status !== "succeeded") continue;
    if (
      refund.currency !== order.currency ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount < 0
    )
      throw mismatch();
    refundedMinor += refund.amount;
  }
  if (!Number.isSafeInteger(refundedMinor) || refundedMinor > order.amountMinor)
    throw mismatch();
  const disputes = await stripe.disputes.list({
    payment_intent: pi.id,
    limit: 100,
  });
  if (disputes.has_more) throw mismatch();
  // Won/closed warnings restore entitlement, but successful refunds remain.
  const disputed = disputes.data.some(
    (item) => !["won", "warning_closed", "prevented"].includes(item.status),
  );
  return {
    paid: true,
    expired: false,
    paymentIntentId: pi.id,
    refundedMinor,
    disputed,
  };
}
export const stripeNoticeTypes = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);
export function stripeNotice(event: Stripe.Event, live: boolean) {
  if (event.livemode !== live || event.account)
    throw new AppError("INVALID_WEBHOOK", "Unexpected payment notification.");
  if (!stripeNoticeTypes.has(event.type)) return null;
  const object = event.data.object;
  if (!("id" in object) || typeof object.id !== "string")
    throw new AppError("INVALID_WEBHOOK", "Invalid payment notification.");
  return { _id: `stripe:${event.id}`, type: event.type, objectId: object.id };
}
export async function noticeOrderId(stripe: Stripe, notice: PaymentNotice) {
  if (notice.type.startsWith("checkout.session.")) {
    const checkout = await stripe.checkout.sessions.retrieve(notice.objectId);
    return { orderId: checkout.metadata?.unibaseOrder, sessionId: checkout.id };
  }
  let piId: string | undefined;
  if (notice.type.startsWith("charge.dispute."))
    piId = id((await stripe.disputes.retrieve(notice.objectId)).payment_intent);
  else if (notice.type.startsWith("refund."))
    piId = id((await stripe.refunds.retrieve(notice.objectId)).payment_intent);
  else
    piId = id((await stripe.charges.retrieve(notice.objectId)).payment_intent);
  return {
    orderId: piId
      ? (await stripe.paymentIntents.retrieve(piId)).metadata.unibaseOrder
      : undefined,
    paymentIntentId: piId,
  };
}
