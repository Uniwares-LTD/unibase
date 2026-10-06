import "server-only";
import type Stripe from "stripe";
import type { Db } from "mongodb";
import { AppError } from "../auth-policy";
import {
  ensureCheckout,
  noticeOrderId,
  verifiedStripeState,
} from "./stripe-provider";
import {
  attachCheckout,
  finishPaymentNotice,
  leasePaymentNotice,
  leasePaymentOrder,
  paymentOrders,
  reconcilePayment,
  releasePaymentOrder,
} from "./store/payments";
import { readWallet } from "./store/credits";
import type { CreditLot, Reservation } from "./store/credit-types";

export async function processPaymentOrder(
  db: Db,
  stripe: Stripe,
  orderId: string,
  knownSessionId?: string,
) {
  const order = await leasePaymentOrder(db, orderId);
  if (!order)
    throw new AppError("PAYMENT_RETRY", "Payment processing is busy.", 409);
  try {
    if (!order.sessionId) {
      const checkout = knownSessionId
        ? await stripe.checkout.sessions.retrieve(knownSessionId)
        : await ensureCheckout(stripe, order);
      if (
        checkout.metadata?.unitaleOrder !== order._id ||
        checkout.client_reference_id !== order._id
      )
        throw new AppError(
          "PAYMENT_TERMS_MISMATCH",
          "Payment does not match the order.",
          409,
        );
      await attachCheckout(db, order, checkout.id);
      order.sessionId = checkout.id;
      order.revision++;
    } else if (knownSessionId && knownSessionId !== order.sessionId)
      throw new AppError(
        "PAYMENT_TERMS_MISMATCH",
        "Payment does not match the order.",
        409,
      );
    await reconcilePayment(db, order, await verifiedStripeState(stripe, order));
  } finally {
    await releasePaymentOrder(db, order);
  }
}

export async function processOnePaymentNotice(db: Db, stripe: Stripe) {
  const notice = await leasePaymentNotice(db);
  if (!notice) return false;
  try {
    const target = await noticeOrderId(stripe, notice);
    if (target.orderId && /^[a-f0-9]{64}$/.test(target.orderId)) {
      const order = await paymentOrders(db).findOne({
        _id: target.orderId,
        provider: "stripe",
      });
      if (!order)
        throw new AppError("PAYMENT_RETRY", "Order recovery is pending.", 409);
      let sessionId = "sessionId" in target ? target.sessionId : undefined;
      // A charge/refund may arrive before the Checkout notification and after
      // the creation response was lost. Recover the unique session by PI.
      if (
        !order.sessionId &&
        !sessionId &&
        order.createdAt.getTime() < Date.now() - 23 * 3600000
      ) {
        if (!target.paymentIntentId)
          throw new AppError(
            "PAYMENT_RETRY",
            "Checkout recovery is pending.",
            409,
          );
        const candidates = await stripe.checkout.sessions.list({
          payment_intent: target.paymentIntentId,
          limit: 2,
        });
        if (candidates.data.length !== 1 || candidates.has_more)
          throw new AppError(
            "PAYMENT_RETRY",
            "Checkout recovery is pending.",
            409,
          );
        sessionId = candidates.data[0].id;
      }
      await processPaymentOrder(db, stripe, order._id, sessionId);
    }
    await finishPaymentNotice(db, notice, true);
  } catch (error) {
    await finishPaymentNotice(db, notice, false);
    throw error;
  }
  return true;
}

export async function maintainCredits(db: Db) {
  const now = new Date();
  const dueHold = await db
    .collection<Reservation>("creditReservations")
    .findOne(
      { status: "active", expiresAt: { $lte: now } },
      { sort: { expiresAt: 1 } },
    );
  const dueLot = await db.collection<CreditLot>("creditLots").findOne(
    {
      expiresAt: { $type: "date", $lte: now },
      $expr: { $gt: ["$remaining", "$reserved"] },
    },
    { sort: { expiresAt: 1 } },
  );
  const uids = new Set(
    [dueHold?.uid, dueLot?.uid].filter((uid): uid is string => !!uid),
  );
  for (const uid of uids) await readWallet(db, uid);
  return uids.size > 0;
}
