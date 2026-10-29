// Image-owned settings only. Never load private host configuration into the image.
const environments = ["local", "staging", "production"];
const keys = ["DIAGNOSTICS_ENABLED"];

function selectRuntimeSettings(document, environment) {
  if (
    !document ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    Object.keys(document).length !== environments.length ||
    !environments.includes(environment)
  )
    throw new Error("Invalid application runtime settings.");
  for (const name of environments) {
    const settings = document[name];
    if (
      !settings ||
      typeof settings !== "object" ||
      Array.isArray(settings) ||
      Object.keys(settings).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(settings, key)) ||
      !["true", "false"].includes(settings.DIAGNOSTICS_ENABLED) ||
      (name === "production" && settings.DIAGNOSTICS_ENABLED !== "false")
    )
      throw new Error("Invalid application runtime settings.");
  }
  return { DIAGNOSTICS_ENABLED: document[environment].DIAGNOSTICS_ENABLED };
}

function applyRuntimeSettings(document, env) {
  const environment = env.APP_ENV ?? "local";
  const settings = selectRuntimeSettings(document, environment);
  if (environment === "production" && env.DIAGNOSTICS_ENABLED === "true")
    throw new Error("Diagnostics is forbidden in production.");
  Object.assign(env, settings);
}

module.exports = { selectRuntimeSettings, applyRuntimeSettings };
