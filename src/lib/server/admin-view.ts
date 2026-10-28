import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "../auth-policy";
import { requireAdmin } from "./admin";
import { signInRedirect } from "./session";

export async function adminPageSession() {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED")
      return signInRedirect();
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
