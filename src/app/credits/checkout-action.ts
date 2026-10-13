"use server";
import { errorMessage } from "@/lib/server/error-message";
import { limitRequest } from "@/lib/server/rate-limit";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { requireSession } from "@/lib/server/session";
import { startStripeCheckout } from "@/lib/server/stripe";
import { logOperation } from "@/lib/server/log";
export async function checkoutCredits(
  expectedUid: string,
  _state: { message: string },
  form: FormData,
) {
  const started = performance.now();
  let url: string;
  try {
    requireSameOrigin(await headers(), getConfig().server.origin);
    const actor = await requireSession();
    await limitRequest("account:" + actor.uid, "mutation");
    if (actor.uid !== expectedUid)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Reload after changing account.",
        409,
      );
    const pack = form.get("packId"),
      key = form.get("key");
    if (typeof pack !== "string" || typeof key !== "string")
      throw new AppError("INVALID_INPUT", "Choose a credit pack.");
    // Each pack button is its own retryable purchase attempt.
    url = (await startStripeCheckout(pack, `${key}:${pack}`)).url;
    logOperation("stripe-checkout", started, 200);
  } catch (error) {
    unstable_rethrow(error);
    logOperation(
      "stripe-checkout",
      started,
      error instanceof AppError ? error.status : 503,
    );
    return {
      message: await errorMessage(
        error instanceof AppError
          ? error
          : new AppError(
              "SERVICE_UNAVAILABLE",
              "Checkout is temporarily unavailable.",
              503,
            ),
      ),
    };
  }
  redirect(url);
}
