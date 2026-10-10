"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AppError, requireSameOrigin } from "@/lib/auth-policy";
import { getConfig } from "@/lib/server/config";
import { requireSession } from "@/lib/server/session";
import {
  updateMyAccountDetails,
  updateMyAppearance,
} from "@/lib/server/profiles";
import { unstable_rethrow } from "next/navigation";
import { logOperation } from "@/lib/server/log";

export async function saveProfile(
  expectedUid: string,
  _previous: { message: string; saved: boolean },
  form: FormData,
) {
  return saveSection(
    expectedUid,
    () => updateMyAccountDetails({ displayName: form.get("displayName") }),
    "Profile saved.",
  );
}

export async function saveAppearance(
  expectedUid: string,
  _previous: { message: string; saved: boolean },
  form: FormData,
) {
  return saveSection(
    expectedUid,
    () =>
      updateMyAppearance({
        theme: form.get("theme"),
        style: form.get("style"),
      }),
    "Preferences saved.",
  );
}

async function saveSection(
  expectedUid: string,
  update: () => Promise<unknown>,
  message: string,
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
    await update();
    revalidatePath("/account");
    revalidatePath("/preferences");
    logOperation("profile-save", started, 200);
    return { message, saved: true };
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
