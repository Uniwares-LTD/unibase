import "server-only";
import { AppError } from "@/lib/auth-policy";
import { cleanupExecuteSchema } from "@/lib/contracts/operations";
import { database } from "./mongo";
import { requireAdmin } from "./admin";
import { aiJobs } from "./ai/jobs";
import { parseDifyConfig } from "@/lib/config/dify";
import { creditConfig } from "./credit-config";
import { healthyHeartbeat, type WorkerHeartbeat } from "./worker-heartbeat";
import {
  previewCleanup,
  executeCleanup,
  recentCleanupReports,
} from "./store/cleanup";
import { paymentOrders, paymentNotices } from "./store/payments";
import { reviewPaymentOrder, type PaymentReview } from "./store/payment-review";
import { processPaymentOrder } from "./payment-worker";
import { stripeClient } from "./stripe";

export async function operationsSummary() {
  await requireAdmin();
  const db = database();
  const pending = {
    status: {
      $in: ["queued", "dispatching", "running", "paused", "unknown"] as const,
    },
  };
  const [queued, unresolved, oldest, inbox, oldestNotice, beats] =
    await Promise.all([
      aiJobs(db).countDocuments(pending),
      aiJobs(db).countDocuments({
        status: { $in: ["needs-review", "settlement-blocked"] },
      }),
      aiJobs(db).findOne(pending, { sort: { createdAt: 1 } }),
      paymentNotices(db).countDocuments({ status: "pending" }),
      paymentNotices(db).findOne(
        { status: "pending" },
        { sort: { createdAt: 1 } },
      ),
      db
        .collection<WorkerHeartbeat>("workerHeartbeats")
        .find({ updatedAt: { $gt: new Date(Date.now() - 86400000) } })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray(),
    ]);
  const age = (date?: Date) =>
    date ? Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000)) : null;
  const commit = process.env.RELEASE_COMMIT ?? "local";
  return {
    queued,
    unresolved,
    queueAgeSeconds: age(oldest?.createdAt),
    paymentPending: inbox,
    paymentAgeSeconds: age(oldestNotice?.createdAt),
    workers: (["payment", "ai"] as const).map((kind) => {
      const enabled =
        kind === "payment" || parseDifyConfig(process.env).mode !== "disabled";
      const beat = beats.find((b) => b.kind === kind && b.commit === commit);
      return {
        kind,
        enabled,
        healthy:
          !!beat &&
          healthyHeartbeat(beat) &&
          (!enabled || beat.state !== "disabled"),
        state: !enabled
          ? "disabled"
          : beat
            ? healthyHeartbeat(beat)
              ? beat.state
              : "unhealthy"
            : "missing",
        ageSeconds: age(beat?.updatedAt),
      };
    }),
    stripeEnabled: creditConfig().mode === "stripe",
  };
}
export async function createCleanupPreview(input: unknown) {
  const actor = await requireAdmin(true);
  return previewCleanup(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    input,
  );
}
export async function runCleanup(input: unknown) {
  const actor = await requireAdmin(true);
  const parsed = cleanupExecuteSchema.parse(input);
  return executeCleanup(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    parsed.reportId,
    parsed.reason,
  );
}
export async function cleanupReports() {
  await requireAdmin();
  return recentCleanupReports(database());
}

export async function reviewPayment(input: unknown) {
  const actor = await requireAdmin(true);
  if (creditConfig().mode !== "stripe")
    throw new AppError(
      "PAYMENTS_DISABLED",
      "Stripe reconciliation is not enabled.",
      409,
    );
  const db = database();
  return reviewPaymentOrder(
    db,
    { uid: actor.uid, authTime: actor.auth_time },
    input,
    (orderId, sessionId) =>
      processPaymentOrder(db, stripeClient(), orderId, sessionId),
  );
}
export async function paymentOperations() {
  await requireAdmin();
  const db = database();
  const [orders, reviews] = await Promise.all([
    paymentOrders(db)
      .find({ status: { $in: ["pending", "disputed"] } })
      .sort({ updatedAt: 1 })
      .limit(25)
      .toArray(),
    db
      .collection<PaymentReview>("paymentReviews")
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray(),
  ]);
  return {
    orders: orders.map((o) => ({
      id: o._id,
      uid: o.uid,
      status: o.status,
      updatedAt: o.updatedAt.toISOString(),
    })),
    reviews: reviews.map((r) => ({
      id: r._id,
      orderId: r.orderId,
      state: r.state,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
