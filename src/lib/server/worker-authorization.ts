import "server-only";
import { adminAuth } from "./firebase";

export async function authorizeWorkerAccount(uid: string, authTime: number) {
  try {
    const user = await adminAuth().getUser(uid);
    return (
      !user.disabled &&
      user.emailVerified &&
      authTime >=
        Math.floor(Date.parse(user.tokensValidAfterTime ?? "1970-01-01") / 1000)
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "auth/user-not-found"
    )
      return false;
    throw error;
  }
}
