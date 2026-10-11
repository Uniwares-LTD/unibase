import "server-only";
import { parseCreditConfig, parsePaymentMode } from "../config/credits";
import { getAuthConfig } from "./auth-config";
import { getConfig } from "./config";

export function creditConfig() {
  return {
    mode: parsePaymentMode(
      process.env,
      getConfig().server.environment,
      getAuthConfig().server.mode,
    ),
  };
}

export async function runtimeCreditConfig() {
  const { readSettings } = await import("./settings");
  const { settings } = await readSettings();
  return parseCreditConfig(
    {
      ...process.env,
      CREDIT_PACKS_JSON: JSON.stringify(settings.credits.packs),
    },
    getConfig().server.environment,
    getAuthConfig().server.mode,
  );
}
