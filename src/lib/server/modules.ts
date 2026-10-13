import "server-only";
import { AppError } from "../auth-policy";
import { moduleEnabled, type ModuleId } from "../project";
export function requireModule(id: ModuleId) {
  if (!moduleEnabled(id))
    throw new AppError(
      "MODULE_UNAVAILABLE",
      "This feature is unavailable.",
      404,
    );
}
