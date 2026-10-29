"use server";
import { getTranslations } from "next-intl/server";
import { errorMessage } from "@/lib/server/error-message";
import { limitRequest } from "@/lib/server/rate-limit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { logOperation } from "@/lib/server/log";
import {
  requireAdmin,
  updateManagedAccess,
  updateManagedProfile,
} from "@/lib/server/admin";

export async function changeUser(
  kind: "access" | "profile",
  expectedActor: string,
  targetUid: string,
  _previous: { message: string; saved: boolean },
  form: FormData,
) {
  const started = performance.now();
  const event =
    kind === "access" ? "admin-access-change" : "admin-profile-edit";
  try {
    requireSameOrigin(await headers(), getConfig().server.origin);
    const actor = await requireAdmin();
    await limitRequest("account:" + actor.uid, "mutation");
    if (actor.uid !== expectedActor)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Your account changed. Reload before editing.",
        409,
      );
    if (form.get("confirmed") !== "yes")
      throw new AppError(
        "CONFIRMATION_REQUIRED",
        "Confirm this administrative change.",
      );
    const reason = form.get("reason") ?? undefined;
    if (kind === "access")
      await updateManagedAccess({
        targetUid,
        reason,
        role: form.get("role"),
        status: form.get("status"),
      });
    else if (kind === "profile")
      await updateManagedProfile({
        targetUid,
        reason,
        displayName: form.get("displayName"),
      });
    else throw new AppError("INVALID_INPUT", "Unknown administrative change.");
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${encodeURIComponent(targetUid)}`);
    revalidatePath("/account");
    revalidatePath("/preferences");
    logOperation(event, started, 200);
    return {
      message: (await getTranslations("actions"))("m01f2d087f576"),
      saved: true,
    };
  } catch (error) {
    unstable_rethrow(error);
    logOperation(
      event,
      started,
      error instanceof AppError ? error.status : 503,
    );
    return {
      message: await errorMessage(
        error instanceof AppError
          ? error
          : new AppError("SERVICE_UNAVAILABLE", "Please try again.", 503),
      ),
      saved: false,
    };
  }
}
