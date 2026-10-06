import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { CreditActor } from "./credit-types";
import { AppError } from "@/lib/auth-policy";
import { paymentReviewSchema } from "@/lib/contracts/operations";
import { accessTransaction, type AuditEntry } from "./access";
import { paymentOrders } from "./payments";

export type PaymentReview = {
  _id: string;
  actorUid: string;
  orderId: string;
  sessionId?: string;
  reason: string;
  state: "started" | "completed" | "needs-review";
  createdAt: Date;
};
export async function reviewPaymentOrder(
  db: Db,
  actor: CreditActor,
  input: unknown,
  reconcile: (orderId: string, sessionId?: string) => Promise<void>,
) {
  const parsed = paymentReviewSchema.parse(input);
  const collection = db.collection<PaymentReview>("paymentReviews");
  const created = await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const previous = await collection.findOne(
        { _id: parsed.key },
        { session },
      );
      if (previous) {
        if (
          previous.actorUid !== actor.uid ||
          previous.orderId !== parsed.orderId ||
          previous.sessionId !== parsed.sessionId ||
          previous.reason !== parsed.reason
        )
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This request key was already used.",
            409,
          );
        return false;
      }
      const order = await paymentOrders(db).findOne(
        { _id: parsed.orderId },
        { session },
      );
      if (!order)
        throw new AppError("NOT_FOUND", "Payment order not found.", 404);
      await collection.insertOne(
        {
          _id: parsed.key,
          actorUid: actor.uid,
          orderId: parsed.orderId,
          ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
          reason: parsed.reason,
          state: "started",
          createdAt: new Date(),
        },
        { session },
      );
      await db.collection<AuditEntry>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "payment-review",
          actorUid: actor.uid,
          targetUid: order.uid,
          reason: `${parsed.orderId}: ${parsed.reason}`,
          timestamp: new Date(),
        },
        { session },
      );
      return true;
    },
    actor.authTime,
  );
  if (created) {
    let state: PaymentReview["state"] = "completed";
    try {
      await reconcile(parsed.orderId, parsed.sessionId);
    } catch {
      state = "needs-review";
    }
    await collection.updateOne({ _id: parsed.key }, { $set: { state } });
  }
  const report = await collection.findOne({ _id: parsed.key });
  return { state: report!.state };
}
