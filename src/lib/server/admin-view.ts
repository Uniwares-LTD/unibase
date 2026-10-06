import "server-only";
import { redirect, notFound } from "next/navigation";
import { AppError } from "../auth-policy";
import { requireAdmin } from "./admin";

export async function adminPageSession() {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED")
      redirect("/account");
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
