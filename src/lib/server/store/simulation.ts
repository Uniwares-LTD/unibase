import "server-only";
import { createHash } from "node:crypto";
import type { ClientSession, Db } from "mongodb";
import { AppError } from "../../auth-policy";
import type { CreditActor } from "./credit-types";
import { grantCredits, readWallet, reversePurchase } from "./credits";

export type SimulationOrder = {
  _id: string;
  uid: string;
  provider: "simulation";
  packId: string;
  label: string;
  credits: number;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  createdAt: Date;
  updatedAt: Date;
};
export type SimulationEvent =
  "success" | "pending" | "failure" | "cancel" | "refund" | "replay";
const orders = (db: Db) => db.collection<SimulationOrder>("purchaseOrders");
const closed = () =>
  new AppError(
    "ORDER_CLOSED",
    "This simulated purchase is already closed.",
    409,
  );

export async function createSimulationOrder(
  db: Db,
  actor: CreditActor,
  key: string,
  pack: { id: string; label: string; credits: number },
) {
  if (
    !/^[A-Za-z0-9_:-]{1,128}$/.test(key) ||
    !Number.isSafeInteger(pack.credits) ||
    pack.credits <= 0
  )
    throw new AppError("INVALID_INPUT", "Choose a valid credit pack.");
  const id = createHash("sha256")
    .update(JSON.stringify([actor.uid, "simulation-order", key]))
    .digest("hex");
  // Gate the insert with the same fresh user-access fence as wallet operations.
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
      const prior = await orders(db).findOne({ _id: id }, { session });
      if (prior) {
        if (prior.packId !== pack.id || prior.credits !== pack.credits)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This purchase key was already used for another pack.",
            409,
          );
        return;
      }
      await orders(db).insertOne(
        {
          _id: id,
          uid: actor.uid,
          provider: "simulation",
          packId: pack.id,
          label: pack.label,
          credits: pack.credits,
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        { session },
      );
    },
  });
  return id;
}

async function getOrder(
  db: Db,
  uid: string,
  id: string,
  session?: ClientSession,
) {
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new AppError(
      "ORDER_NOT_FOUND",
      "Simulated purchase was not found.",
      404,
    );
  const order = await orders(db).findOne(
    { _id: id, uid, provider: "simulation" },
    { session },
  );
  if (!order)
    throw new AppError(
      "ORDER_NOT_FOUND",
      "Simulated purchase was not found.",
      404,
    );
  return order;
}

export async function simulatePurchase(
  db: Db,
  actor: CreditActor,
  id: string,
  event: SimulationEvent,
) {
  if (
    !["success", "pending", "failure", "cancel", "refund", "replay"].includes(
      event,
    )
  )
    throw new AppError("INVALID_INPUT", "Choose a valid simulation outcome.");
  const order = await getOrder(db, actor.uid, id);
  const reference = `simulation:${order._id}`;
  const update = async (
    session: ClientSession,
    target: SimulationOrder["status"],
    from: SimulationOrder["status"][],
  ) => {
    const current = await getOrder(db, actor.uid, id, session);
    if (current.status === target) return;
    if (!from.includes(current.status)) throw closed();
    await orders(db).updateOne(
      { _id: id },
      { $set: { status: target, updatedAt: new Date() } },
      { session },
    );
  };
  if (event === "success" || event === "replay") {
    if (event === "replay" && !["paid", "refunded"].includes(order.status))
      throw closed();
    return grantCredits(
      db,
      actor.uid,
      `sim-success:${id}`,
      { amount: order.credits, source: "purchase", reference },
      {
        actor,
        // A refund does not re-credit on an old success replay. The same successful
        // grant key already exists and its original result is returned.
        persist:
          event === "replay"
            ? async (session) => {
                const current = await getOrder(db, actor.uid, id, session);
                if (!["paid", "refunded"].includes(current.status))
                  throw closed();
              }
            : (session) => update(session, "paid", ["pending"]),
      },
    );
  }
  if (event === "refund")
    return reversePurchase(
      db,
      actor.uid,
      `sim-refund:${id}`,
      reference,
      order.credits,
      {
        actor,
        persist: (session) => update(session, "refunded", ["paid"]),
      },
    );
  const status =
    event === "failure"
      ? "failed"
      : event === "cancel"
        ? "cancelled"
        : "pending";
  return readWallet(db, actor.uid, {
    actor,
    persist: (session) => update(session, status, ["pending"]),
  });
}

export async function createPurchaseIndexes(db: Db) {
  await orders(db).createIndex({ uid: 1, createdAt: -1, _id: -1 });
}
