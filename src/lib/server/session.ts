import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError, requireRecentLogin, SESSION_SECONDS } from "../auth-policy";
import { signInPath } from "../return-path";
import { adminAuth } from "./firebase";
import { cookieName, cookieOptions } from "./http";
import { database } from "./mongo";
import { signinAppearance } from "./store/signin-appearance";
import {
  accountAccess,
  accessPermitsSession,
  initializeSignupAdmin,
} from "./store/access";

export async function getSession() {
  const value = (await cookies()).get(cookieName("session"))?.value;
  if (!value) return null;
  try {
    const session = await adminAuth().verifySessionCookie(value, true);
    const access = await accountAccess(database(), session.uid);
    return accessPermitsSession(access, session.auth_time) ? session : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code &&
      [
        "auth/session-cookie-expired",
        "auth/session-cookie-revoked",
        "auth/invalid-session-cookie",
        "auth/argument-error",
        "auth/user-disabled",
        "auth/user-not-found",
      ].includes(code)
    )
      return null;
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Account service is temporarily unavailable.",
      503,
    );
  }
}
export async function requireSession(verified = true) {
  const session = await getSession();
  if (!session)
    throw new AppError("UNAUTHENTICATED", "Please sign in to continue.", 401);
  if (verified && (!session.email_verified || !session.email))
    throw new AppError(
      "EMAIL_UNVERIFIED",
      "Verify your email to continue.",
      403,
    );
  return session;
}
// Pages send signed-out visitors to sign in, then back to the requested path.
export async function signInRedirect(): Promise<never> {
  redirect(signInPath((await headers()).get("x-pathname")));
}
export async function pageSession(verified = true) {
  try {
    return await requireSession(verified);
  } catch (error) {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      return signInRedirect();
    throw error;
  }
}
export async function createSession(idToken: string) {
  const auth = adminAuth();
  let claims;
  try {
    claims = await auth.verifyIdToken(idToken, true);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (
      code &&
      [
        "auth/argument-error",
        "auth/invalid-id-token",
        "auth/id-token-expired",
        "auth/id-token-revoked",
        "auth/user-disabled",
        "auth/user-not-found",
      ].includes(code)
    ) {
      throw new AppError("INVALID_CREDENTIAL", "Please sign in again.", 401);
    }
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "Account service is temporarily unavailable.",
      503,
    );
  }
  requireRecentLogin(claims);
  if (
    !accessPermitsSession(
      await accountAccess(database(), claims.uid),
      claims.auth_time,
    )
  )
    throw new AppError(
      "ACCOUNT_SUSPENDED",
      "This account cannot sign in. Contact an administrator.",
      403,
    );
  const value = await auth.createSessionCookie(idToken, {
    expiresIn: SESSION_SECONDS * 1000,
  });
  await initializeSignupAdmin(database(), claims);
  (await cookies()).set(cookieName("session"), value, {
    ...cookieOptions(),
    maxAge: SESSION_SECONDS,
  });
  return {
    verified: claims.email_verified === true,
    appearance: claims.email_verified
      ? await signinAppearance(database(), claims.uid)
      : undefined,
  };
}
export async function clearSession() {
  const session = await getSession();
  if (session) await adminAuth().revokeRefreshTokens(session.uid);
  (await cookies()).set(cookieName("session"), "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}
