export const SESSION_SECONDS = 60 * 60 * 24 * 5;
export const RECENT_LOGIN_SECONDS = 60 * 30;

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function requireRecentLogin(
  claims: { auth_time: number; iat: number },
  now = Date.now() / 1000,
) {
  if (
    !Number.isFinite(claims.auth_time) ||
    !Number.isFinite(claims.iat) ||
    now - claims.auth_time > RECENT_LOGIN_SECONDS ||
    claims.auth_time > now + 60 ||
    now - claims.iat > RECENT_LOGIN_SECONDS ||
    claims.iat > now + 60
  ) {
    throw new AppError(
      "RECENT_LOGIN_REQUIRED",
      "Please sign in again to continue.",
      401,
    );
  }
}

export function requireSameOrigin(headers: Headers, origin: string) {
  if (
    headers.get("origin") !== origin ||
    ["cross-site", "same-site"].includes(headers.get("sec-fetch-site") ?? "")
  ) {
    throw new AppError("INVALID_ORIGIN", "This request is not allowed.", 403);
  }
}
