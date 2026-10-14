import { z } from "zod";

export function parsePersonaCompletionConfig(
  env: Record<string, string | undefined>,
) {
  const mode = z
    .enum(["disabled", "fake", "live"])
    .parse(env.PERSONA_COMPLETION_MODE ?? "disabled");
  if (mode !== "live") return { mode, baseUrl: "", apiKey: "" };
  let url: URL;
  try {
    url = new URL(env.PERSONA_COMPLETION_BASE_URL ?? "");
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          env.APP_ENV === "local" &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error();
  } catch {
    throw new Error(
      "PERSONA_COMPLETION_BASE_URL must be an HTTPS API base URL (local loopback HTTP is allowed locally).",
    );
  }
  const apiKey = env.PERSONA_COMPLETION_API_KEY?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey))
    throw new Error(
      "PERSONA_COMPLETION_API_KEY is required for live completions.",
    );
  return { mode, baseUrl: url.href.replace(/\/$/, ""), apiKey };
}
