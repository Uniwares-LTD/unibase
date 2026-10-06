import "server-only";
import { parseCreditConfig } from "../config/credits";
import { getAuthConfig } from "./auth-config";
import { getConfig } from "./config";

export function creditConfig() {
  return parseCreditConfig(
    {
      PAYMENTS_MODE: process.env.PAYMENTS_MODE,
      CREDIT_PACKS_JSON: process.env.CREDIT_PACKS_JSON,
    },
    getConfig().server.environment,
    getAuthConfig().server.mode,
  );
}
