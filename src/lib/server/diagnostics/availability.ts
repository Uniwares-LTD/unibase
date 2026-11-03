import "server-only";
import { parseDiagnosticsConfig } from "../../config/diagnostics";

export function diagnosticsConfig() {
  try {
    return parseDiagnosticsConfig(process.env);
  } catch {
    // Invalid or forbidden enablement (e.g. production) keeps it disabled.
    return { enabled: false } as const;
  }
}
/** Page-safe summary for the application settings card. */
export function diagnosticsAvailability() {
  const config = diagnosticsConfig();
  return {
    enabled: config.enabled,
    redisConfigured: config.enabled && !!config.redisUrl,
  };
}
