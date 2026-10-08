import { loadEnvConfig } from "@next/env";
import { parseConfig } from "../src/lib/config/schema";
import { parseAuthConfig } from "../src/lib/config/auth";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { assetLinks } from "../src/lib/config/android";
import { parseCreditConfig } from "../src/lib/config/credits";
import { parseStripeConfig } from "../src/lib/config/payments";
import { parseDifyConfig } from "../src/lib/config/dify";
import { parseAiPricing } from "../src/lib/config/ai-pricing";
import { parseAssetConfig } from "../src/lib/config/assets";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

try {
  const config = parseConfig(process.env);
  parseDatabaseConfig(process.env, config.server.environment);
  const auth = parseAuthConfig(
    process.env,
    config.server.environment,
    config.server.origin,
  );
  const credits = parseCreditConfig(
    process.env,
    config.server.environment,
    auth.server.mode,
  );
  parseStripeConfig(process.env, credits.mode === "stripe");
  parseDifyConfig(process.env);
  parseAiPricing(process.env);
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
