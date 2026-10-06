"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { requireSession } from "@/lib/server/session";
import {
  changeSimulatedPurchase,
  startSimulatedPurchase,
} from "@/lib/server/purchases";
import type { SimulationEvent } from "@/lib/server/store/simulation";
import type { DiagnosticEvent } from "@/lib/diagnostics";
import { logOperation } from "@/lib/server/log";

type State = { message: string; saved: boolean };
async function guard(expectedUid: string) {
  requireSameOrigin(await headers(), getConfig().server.origin);
  const actor = await requireSession();
  if (actor.uid !== expectedUid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
}
function failure(
  error: unknown,
  event: DiagnosticEvent,
  started: number,
): State {
  unstable_rethrow(error);
  logOperation(event, started, error instanceof AppError ? error.status : 503);
  return {
    message:
      error instanceof AppError
        ? error.message
        : "Couldn’t complete this simulation. Please try again.",
    saved: false,
  };
}
export async function startSimulation(
  expectedUid: string,
  _previous: State,
  form: FormData,
): Promise<State> {
  const started = performance.now();
  try {
    await guard(expectedUid);
    const pack = form.get("packId");
    const key = form.get("key");
    if (typeof pack !== "string" || typeof key !== "string")
      throw new AppError("INVALID_INPUT", "Choose a credit pack.");
    await startSimulatedPurchase(pack, key);
    revalidatePath("/credits");
    logOperation("purchase-simulation-start", started, 200);
    return {
      message:
        "Simulated purchase created. Choose its outcome below. No money was charged.",
      saved: true,
    };
  } catch (error) {
    return failure(error, "purchase-simulation-start", started);
  }
}
export async function applySimulation(
  expectedUid: string,
  orderId: string,
  _previous: State,
  form: FormData,
): Promise<State> {
  const started = performance.now();
  try {
    await guard(expectedUid);
    const event = form.get("event");
    if (
      typeof event !== "string" ||
      !["success", "pending", "failure", "cancel", "refund", "replay"].includes(
        event,
      )
    )
      throw new AppError("INVALID_INPUT", "Choose a simulation outcome.");
    await changeSimulatedPurchase(orderId, event as SimulationEvent);
    revalidatePath("/credits");
    revalidatePath("/admin/users");
    logOperation("purchase-simulation-event", started, 200);
    return {
      message:
        event === "replay"
          ? "Prior success replayed. No extra credits were issued."
          : "Simulated outcome saved. No money was charged.",
      saved: true,
    };
  } catch (error) {
    return failure(error, "purchase-simulation-event", started);
  }
}
