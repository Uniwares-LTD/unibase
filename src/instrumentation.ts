export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getConfig } = await import("./lib/server/config");
    getConfig();
    const { parseMcpConfig } = await import("./lib/config/mcp");
    parseMcpConfig(process.env, getConfig().server.origin);
    const { parseDifyConfig } = await import("./lib/config/dify");
    parseDifyConfig(process.env);
    const { parseAssetConfig } = await import("./lib/config/assets");
    parseAssetConfig(process.env);
    const { getDatabaseConfig } = await import("./lib/server/database-config");
    getDatabaseConfig();
    const { getAuthConfig } = await import("./lib/server/auth-config");
    getAuthConfig();
    const { creditConfig } = await import("./lib/server/credit-config");
    const credits = creditConfig();
    const { parseStripeConfig } = await import("./lib/config/payments");
    parseStripeConfig(
      {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      },
      credits.mode === "stripe",
    );
    const { assetLinks } = await import("./lib/config/android");
    assetLinks(
      process.env.ANDROID_PACKAGE_NAME,
      process.env.ANDROID_SHA256_FINGERPRINTS,
    );
  }
}

// Do not forward the caught Error, request URL, headers or framework payload.
export const onRequestError: import("next").Instrumentation.onRequestError =
  async () => {
    const { logOperation } = await import("./lib/server/log");
    logOperation("server-error", undefined, 500);
  };
