import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { MongoServerError, type Db, type ClientSession } from "mongodb";
import { AppError } from "../../auth-policy";
import { proportionalCredits } from "../../config/payments";
import { grantCredits, readWallet, reversePurchase } from "./credits";
import type { CreditActor } from "./credit-types";

export type PaymentOrder = {
  _id: string;
  uid: string;
  provider: "stripe";
  packId: string;
  label: string;
  credits: number;
  priceId: string;
  amountMinor: number;
  currency: string;
  origin: string;
  status: "pending" | "paid" | "expired" | "refunded" | "disputed";
  sessionId?: string;
  checkoutUrl?: string;
  paymentIntentId?: string;
  granted: boolean;
  reversed: number;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  leaseToken?: string;
  leaseUntil?: Date;
};
export type PaymentNotice = {
  _id: string;
  provider: "stripe";
  type: string;
  objectId: string;
  status: "pending" | "done";
  attempts: number;
  nextAt: Date;
  createdAt: Date;
  completedAt?: Date;
  leaseToken?: string;
  leaseUntil?: Date;
};
export const paymentOrders = (db: Db) =>
  db.collection<PaymentOrder>("purchaseOrders");
export const paymentNotices = (db: Db) =>
  db.collection<PaymentNotice>("paymentInbox");
const conflict = () =>
  new AppError(
    "PAYMENT_RETRY",
    "Payment processing is busy. Please retry shortly.",
    409,
  );

export async function createPaymentOrder(
  db: Db,
  actor: CreditActor,
  key: string,
  pack: {
    id: string;
    label: string;
    credits: number;
    stripePriceId?: string;
    amountMinor?: number;
    currency?: string;
  },
  origin: string,
) {
  if (
    !/^[A-Za-z0-9_:-]{1,128}$/.test(key) ||
    !pack.stripePriceId ||
    !pack.amountMinor ||
    !pack.currency
  )
    throw new AppError("INVALID_INPUT", "Choose a configured credit pack.");
  const id = createHash("sha256")
    .update(JSON.stringify([actor.uid, "stripe-order", key]))
    .digest("hex");
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
      const prior = await paymentOrders(db).findOne({ _id: id }, { session });
      if (prior) {
        if (prior.provider !== "stripe" || prior.packId !== pack.id)
          throw conflict();
        return; // Preserve original terms across catalog changes and retries.
      }
      await paymentOrders(db).insertOne(
        {
          _id: id,
          uid: actor.uid,
          provider: "stripe",
          packId: pack.id,
          label: pack.label,
          credits: pack.credits,
          priceId: pack.stripePriceId!,
          amountMinor: pack.amountMinor!,
          currency: pack.currency!,
          origin,
          status: "pending",
          granted: false,
          reversed: 0,
          revision: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { session },
      );
    },
  });
  return (await paymentOrders(db).findOne({
    _id: id,
    uid: actor.uid,
    provider: "stripe",
  }))!;
}

export async function leasePaymentOrder(db: Db, id: string, now = new Date()) {
  return paymentOrders(db).findOneAndUpdate(
    {
      _id: id,
      provider: "stripe",
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        leaseToken: randomUUID(),
        leaseUntil: new Date(now.getTime() + 120000),
      },
    },
    { returnDocument: "after" },
  );
}
export async function releasePaymentOrder(db: Db, order: PaymentOrder) {
  await paymentOrders(db).updateOne(
    { _id: order._id, leaseToken: order.leaseToken },
    {
      $set: { updatedAt: new Date() },
      $unset: { leaseUntil: "", leaseToken: "" },
    },
  );
}
async function updateOrder(
  db: Db,
  order: PaymentOrder,
  changes: Partial<PaymentOrder>,
  session?: ClientSession,
) {
  const result = await paymentOrders(db).updateOne(
    {
      _id: order._id,
      leaseToken: order.leaseToken,
      revision: order.revision,
      leaseUntil: { $gt: new Date() },
    },
    { $set: { ...changes, updatedAt: new Date() }, $inc: { revision: 1 } },
    { session },
  );
  if (result.modifiedCount !== 1) throw conflict();
}
export async function attachCheckout(
  db: Db,
  order: PaymentOrder,
  sessionId: string,
  checkoutUrl?: string,
) {
  await updateOrder(db, order, {
    sessionId,
    ...(checkoutUrl ? { checkoutUrl } : {}),
  });
}

// A trusted provider adapter supplies the CURRENT canonical state under the
// order lease. Notifications are wakeups, never snapshots that can undo refunds.
export async function reconcilePayment(
  db: Db,
  order: PaymentOrder,
  state: {
    paid: boolean;
    expired: boolean;
    paymentIntentId?: string;
    refundedMinor: number;
    disputed: boolean;
  },
) {
  if (!state.paid) {
    if (order.granted) throw conflict();
    await updateOrder(db, order, {
      status: state.expired ? "expired" : "pending",
    });
    return;
  }
  const target = state.disputed
    ? order.credits
    : proportionalCredits(
        order.credits,
        state.refundedMinor,
        order.amountMinor,
      );
  const reference = `stripe:${order._id}`;
  if (!order.granted) {
    await grantCredits(
      db,
      order.uid,
      `stripe-grant:${order._id}`,
      {
        amount: order.credits,
        source: "purchase",
        reference,
      },
      {
        persist: (session) =>
          updateOrder(
            db,
            order,
            {
              granted: true,
              status: "paid",
              paymentIntentId: state.paymentIntentId,
            },
            session,
          ),
      },
    );
    order = { ...order, granted: true, revision: order.revision + 1 };
  }
  const changes: Partial<PaymentOrder> = {
    reversed: target,
    paymentIntentId: state.paymentIntentId,
    status: state.disputed ? "disputed" : target > 0 ? "refunded" : "paid",
  };
  if (target !== order.reversed) {
    await reversePurchase(
      db,
      order.uid,
      `stripe-reverse:${order._id}:${order.revision}`,
      reference,
      target,
      {
        persist: (session) => updateOrder(db, order, changes, session),
      },
    );
  } else await updateOrder(db, order, changes);
}

export async function enqueuePaymentNotice(
  db: Db,
  notice: Pick<PaymentNotice, "_id" | "type" | "objectId">,
) {
  try {
    await paymentNotices(db).updateOne(
      { _id: notice._id },
      {
        $setOnInsert: {
          ...notice,
          provider: "stripe",
          status: "pending",
          attempts: 0,
          nextAt: new Date(),
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!(error instanceof MongoServerError) || error.code !== 11000)
      throw error;
  }
}
export async function leasePaymentNotice(db: Db, now = new Date()) {
  return paymentNotices(db).findOneAndUpdate(
    {
      status: "pending",
      nextAt: { $lte: now },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }],
    },
    {
      $set: {
        leaseToken: randomUUID(),
        leaseUntil: new Date(now.getTime() + 120000),
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { nextAt: 1, createdAt: 1 } },
  );
}
export async function finishPaymentNotice(
  db: Db,
  notice: PaymentNotice,
  succeeded: boolean,
) {
  await paymentNotices(db).updateOne(
    { _id: notice._id, leaseToken: notice.leaseToken },
    {
      $set: succeeded
        ? { status: "done", completedAt: new Date() }
        : {
            nextAt: new Date(
              Date.now() +
                Math.min(3600000, 1000 * 2 ** Math.min(notice.attempts, 12)),
            ),
          },
      $unset: { leaseToken: "", leaseUntil: "" },
    },
  );
}
export async function createPaymentIndexes(db: Db) {
  await paymentNotices(db).createIndex({ status: 1, nextAt: 1, leaseUntil: 1 });
  await paymentOrders(db).createIndex(
    { sessionId: 1 },
    {
      unique: true,
      partialFilterExpression: { sessionId: { $type: "string" } },
    },
  );
  await paymentOrders(db).createIndex(
    { paymentIntentId: 1 },
    {
      unique: true,
      partialFilterExpression: { paymentIntentId: { $type: "string" } },
    },
  );
  await paymentOrders(db).createIndex({ provider: 1, status: 1, updatedAt: 1 });
}
