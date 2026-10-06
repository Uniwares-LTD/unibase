"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { requireSession } from "@/lib/server/session";
import { updateMyProfile } from "@/lib/server/profiles";
import { unstable_rethrow } from "next/navigation";
import { logOperation } from "@/lib/server/log";

export async function saveProfile(
  expectedUid: string,
  _previous: { message: string; saved: boolean },
  form: FormData,
) {
  const started = performance.now();
  try {
    requireSameOrigin(await headers(), getConfig().server.origin);
    const session = await requireSession();
    if (session.uid !== expectedUid)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Your account changed. Reload this page before editing.",
        409,
      );
    await updateMyProfile({
      displayName: form.get("displayName"),
      theme: form.get("theme"),
      ...(form.has("style") ? { style: form.get("style") } : {}),
    });
    revalidatePath("/account");
    revalidatePath("/preferences");
    logOperation("profile-save", started, 200);
    return { message: "Profile saved.", saved: true };
  } catch (error) {
    unstable_rethrow(error);
    logOperation(
      "profile-save",
      started,
      error instanceof AppError ? error.status : 503,
    );
    return {
      message:
        error instanceof AppError
          ? error.message
          : "Couldn’t save your profile. Please try again.",
      saved: false,
    };
  }
}
