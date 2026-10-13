import { namespace } from "@/lib/project";
export const GOOGLE_REDIRECT_KEY = namespace("google-redirect");

// A restored SDK user is usable only during a recent, explicitly started Google
// flow. Visiting the sign-in page must never revive an unrelated old SDK login.
export function redirectUser<
  T extends { providerData: { providerId: string }[] },
>(
  resultUser: T | null,
  restoredUser: T | null,
  startedAt: string | null,
  now = Date.now(),
): T | null {
  if (resultUser) return resultUser;
  const started = startedAt ? Number(startedAt) : NaN;
  if (
    !Number.isFinite(started) ||
    started > now ||
    now - started > 10 * 60 * 1000
  )
    return null;
  return restoredUser?.providerData.some(
    (provider) => provider.providerId === "google.com",
  )
    ? restoredUser
    : null;
}
