import { z } from "zod";

const bindingSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  revision: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  kind: z.enum(["workflow", "chat"]),
  apiKeyEnv: z.string().regex(/^DIFY_KEY_[A-Z0-9_]+$/),
  workflowId: z.string().uuid().optional(),
});

export type DifyBinding = z.infer<typeof bindingSchema>;
export type DifyConfig =
  | { mode: "disabled" | "fake" }
  | {
      mode: "live";
      baseUrl: string;
      bindings: (DifyBinding & { apiKey: string })[];
    };

// Pure parser for tests/check:env. Only server modules supply process.env.
// Deliberately hide Zod issues: they can contain private input values.
export function parseDifyConfig(
  env: Record<string, string | undefined>,
): DifyConfig {
  const mode = env.DIFY_MODE ?? "disabled";
  if (mode === "disabled" || mode === "fake") return { mode };
  if (mode !== "live") throw new Error("Invalid DIFY_MODE.");
  try {
    const url = new URL(env.DIFY_BASE_URL ?? "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const local = (env.APP_ENV ?? "local") === "local";
    if (
      (url.protocol !== "https:" &&
        !(local && loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*v1\/?$/.test(url.pathname)
    )
      throw new Error();
    const bindings = z
      .array(bindingSchema)
      .min(1)
      .max(100)
      .parse(JSON.parse(env.DIFY_BINDINGS_JSON ?? ""));
    if (new Set(bindings.map((item) => item.name)).size !== bindings.length)
      throw new Error();
    return {
      mode,
      baseUrl: url.href.replace(/\/$/, ""),
      bindings: bindings.map((binding) => {
        const apiKey = env[binding.apiKeyEnv];
        if (!apiKey || apiKey.length > 1024 || /[\s\x00-\x1f\x7f]/.test(apiKey))
          throw new Error();
        return { ...binding, apiKey };
      }),
    };
  } catch {
    throw new Error(
      "Invalid Dify configuration: check DIFY_BASE_URL, DIFY_BINDINGS_JSON and referenced DIFY_KEY_* variables.",
    );
  }
}
