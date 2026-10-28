import "server-only";
import { requireModule } from "./modules";
import { AppError } from "../auth-policy";
import type { PublicOrder, PublicPack } from "../contracts/credits";
import { runtimeCreditConfig } from "./credit-config";
import { database } from "./mongo";
import { requireSession } from "./session";
import {
  createSimulationOrder,
  simulatePurchase,
  type SimulationEvent,
  type SimulationOrder,
} from "./store/simulation";

async function requireSimulation() {
  requireModule("payments");
  const config = await runtimeCreditConfig();
  if (config.mode !== "simulation")
    throw new AppError(
      "SIMULATION_DISABLED",
      "Purchase simulation is available only with local emulators.",
      403,
    );
  return config;
}
export async function publicCatalog(): Promise<{
  mode: "disabled" | "simulation" | "stripe";
  packs: (PublicPack & { amountMinor?: number; currency?: string })[];
}> {
  const config = await runtimeCreditConfig();
  return {
    mode: config.mode,
    // Display prices are public catalog facts; provider price IDs stay server-side.
    packs: config.packs.map(
      ({ id, label, credits, amountMinor, currency }) => ({
        id,
        label,
        credits,
        ...(amountMinor && currency ? { amountMinor, currency } : {}),
      }),
    ),
  };
}
export async function startSimulatedPurchase(packId: string, key: string) {
  const config = await requireSimulation();
  const session = await requireSession();
  const pack = config.packs.find((item) => item.id === packId);
  if (!pack)
    throw new AppError("PACK_NOT_FOUND", "Credit pack was not found.", 404);
  return createSimulationOrder(
    database(),
    { uid: session.uid, authTime: session.auth_time },
    key,
    pack,
  );
}
export async function changeSimulatedPurchase(
  id: string,
  event: SimulationEvent,
) {
  await requireSimulation();
  const session = await requireSession();
  return simulatePurchase(
    database(),
    { uid: session.uid, authTime: session.auth_time },
    id,
    event,
  );
}
export async function currentSimulatedPurchases(): Promise<PublicOrder[]> {
  await requireSimulation();
  const session = await requireSession();
  const orders = await database()
    .collection<SimulationOrder>("purchaseOrders")
    .find({ uid: session.uid, provider: "simulation" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(25)
    .toArray();
  return orders.map((item) => ({
    id: item._id,
    label: item.label,
    credits: item.credits,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
  }));
}
