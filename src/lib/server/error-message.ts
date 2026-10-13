import "server-only";
import { requestLocale } from "./locale";
import type { AppError } from "../auth-policy";
export async function errorMessage(error: AppError) {
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
