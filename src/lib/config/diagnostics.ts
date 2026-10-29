import { rateConfig } from "./rate-limits";

export type DiagnosticsConfig =
  | { enabled: false }
  | {
      enabled: true;
      environment: "local" | "staging";
      redisUrl: string | null;
    };

/**
 * Diagnostics is opt-in and never available in production. Local operation
 * without Redis is reported as unavailable instead of falling back to memory.
 */
export function parseDiagnosticsConfig(
  env: Record<string, string | undefined>,
): DiagnosticsConfig {
  const value = env.DIAGNOSTICS_ENABLED;
  if (value === undefined || value === "" || value === "false")
    return { enabled: false };
  if (value !== "true") throw new Error("Invalid diagnostics enablement.");
  const environment = env.APP_ENV ?? "local";
  if (environment !== "local" && environment !== "staging")
    throw new Error("Diagnostics is not permitted in this environment.");
  return { enabled: true, environment, redisUrl: rateConfig(env).url };
}
