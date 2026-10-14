import catalog from "../../../scripts/deploy/environment-catalog.json";

export { catalog as environmentCatalog };

/** Check application-owned names without rejecting unrelated host environment. */
export function validateEnvironmentNames(
  env: Record<string, string | undefined>,
) {
  const names = new Set<string>([
    ...catalog.runtime,
    ...catalog.localOnly,
    ...catalog.tooling,
  ]);
  const credentials = catalog.credentialPatterns.map(
    (pattern) => new RegExp(pattern),
  );
  for (const key of Object.keys(env)) {
    if (env[key] === undefined) continue;
    if (
      /^(MCP_|RUN_MCP_|DIFY_KEY_|PERSONA_COMPLETION_)/.test(key) &&
      !names.has(key) &&
      !credentials.some((pattern) => pattern.test(key))
    )
      throw new Error(
        "Invalid application environment setting name (values suppressed).",
      );
    if (
      env.APP_ENV &&
      env.APP_ENV !== "local" &&
      catalog.localOnly.includes(key)
    )
      throw new Error("Local-only environment setting is not permitted.");
  }
}
