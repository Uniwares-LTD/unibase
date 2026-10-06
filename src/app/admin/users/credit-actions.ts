"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { requireAdmin } from "@/lib/server/admin";
import { adjustManagedCredits } from "@/lib/server/credits";
import { logOperation } from "@/lib/server/log";

export async function adjustUserCredits(
  expectedActor: string,
  targetUid: string,
  _previous: { message: string; saved: boolean },
  form: FormData,
) {
  const started = performance.now();
  try {
    requireSameOrigin(await headers(), getConfig().server.origin);
    const actor = await requireAdmin(true);
    if (actor.uid !== expectedActor)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Your account changed. Reload before editing.",
        409,
      );
    if (form.get("confirmed") !== "yes")
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "Confirm this credit adjustment.",
      );
    const expiry =
      form.get("direction") === "deduct" ? "default" : form.get("expiry");
    if (!["default", "perpetual", "custom"].includes(String(expiry)))
      throw new AppError("INVALID_INPUT", "Choose a valid grant expiry.");
    let expiresAt: Date | null | undefined;
    if (form.get("direction") === "grant") {
      if (expiry === "perpetual") expiresAt = null;
      if (expiry === "custom") {
        const raw = form.get("expiresAt");
        if (
          typeof raw !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
        )
          throw new AppError(
            "INVALID_INPUT",
            "Enter a future expiry date and time in UTC.",
          );
        expiresAt = new Date(`${raw}:00Z`);
      }
    }
    await adjustManagedCredits({
      targetUid,
      key: form.get("key"),
      direction: form.get("direction"),
      amount: Number(form.get("amount")),
      reason: form.get("reason"),
      expiresAt,
    });
    revalidatePath(`/admin/users/${encodeURIComponent(targetUid)}`);
    revalidatePath("/credits");
    logOperation("credit-adjustment", started, 200);
    return { message: "Credit adjustment saved and audited.", saved: true };
  } catch (error) {
    unstable_rethrow(error);
    logOperation(
      "credit-adjustment",
      started,
      error instanceof AppError ? error.status : 503,
    );
    return {
      message:
        error instanceof AppError
          ? error.message
          : "Couldn’t adjust credits. Please try again.",
      saved: false,
    };
  }
}
