import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { AppError } from "@/lib/auth-policy";
import { cookieName } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { accountAccess } from "@/lib/server/store/access";
import { database } from "@/lib/server/mongo";

// Shell state for the navigation, account menu and home actions, once per request.
export const viewerState = cache(async () => {
  let hasSession = !!(await cookies()).get(cookieName("session"))?.value;
  let isAdmin = false;
  try {
    const session = await getSession();
    hasSession = !!session;
    isAdmin =
      !!session?.email_verified &&
      (await accountAccess(database(), session!.uid)).role === "admin";
  } catch (error) {
    // An account outage must not take down public pages or expose admin navigation.
    // Keep sign-out available for an existing cookie so the user can retry.
    if (!(error instanceof AppError) || error.code !== "SERVICE_UNAVAILABLE")
      throw error;
  }
  return { hasSession, isAdmin };
});
