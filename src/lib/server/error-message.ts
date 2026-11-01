import "server-only";
import { requestLocale } from "./locale";
import type { AppError } from "../auth-policy";
import { headers } from "next/headers";
import { isAdminPath } from "../locale";
export async function errorMessage(error: AppError, pathname?: string) {
  if (isAdminPath(pathname ?? (await headers()).get("x-pathname") ?? ""))
    return error.message;
  const { locale } = await requestLocale();
  if (locale === "en") return error.message;
  const { errors } = await import("../../../messages/ar.json");
  const key =
    error.code === "FILE_IN_USE"
      ? "fileInUse"
      : /QUOTA|FILE_LIMIT|STORAGE_LIMIT/.test(error.code)
        ? "quota"
        : error.status === 401
          ? "auth"
          : error.status === 403
            ? "forbidden"
            : error.status === 404
              ? "missing"
              : error.status === 409
                ? "conflict"
                : error.status === 429
                  ? "limit"
                  : error.status >= 500
                    ? "service"
                    : "input";
  return errors[key];
}
