import { requiredModuleConfigurations as requirements } from "../src/lib/project";
import { rateConfig } from "../src/lib/config/rate-limits";
import { loadEnvConfig } from "@next/env";
import { parseConfig } from "../src/lib/config/schema";
import { parseAuthConfig } from "../src/lib/config/auth";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { assetLinks } from "../src/lib/config/android";
import { parseCreditConfig } from "../src/lib/config/credits";
import { parseStripeConfig } from "../src/lib/config/payments";
import { parsePersonaCompletionConfig } from "../src/lib/config/persona-completion";
import { parseDifyConfig } from "../src/lib/config/dify";
import { parseAssetConfig } from "../src/lib/config/assets";
import { parseMcpConfig } from "../src/lib/config/mcp";
import { parseDiagnosticsConfig } from "../src/lib/config/diagnostics";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

try {
  const config = parseConfig(process.env);
  rateConfig(process.env);
  parseDiagnosticsConfig(process.env);
  if (requirements.has("mcp"))
    parseMcpConfig(process.env, config.server.origin);
  parseDatabaseConfig(process.env, config.server.environment);
  const auth = parseAuthConfig(
    process.env,
    config.server.environment,
    config.server.origin,
  );
  const credits = requirements.has("credits")
    ? parseCreditConfig(
        process.env,
        config.server.environment,
        auth.server.mode,
      )
    : null;
  if (requirements.has("payments"))
    parseStripeConfig(process.env, credits?.mode === "stripe");
  if (requirements.has("runs")) {
    parseDifyConfig(process.env);
    parsePersonaCompletionConfig(process.env);
  }
  if (requirements.has("assets") || requirements.has("runs"))
    parseAssetConfig(process.env);
  assetLinks(
    process.env.ANDROID_PACKAGE_NAME,
    process.env.ANDROID_SHA256_FINGERPRINTS,
  );
  console.log("Configuration valid. No credential values were printed.");
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid configuration.",
  );
  process.exitCode = 1;
}
