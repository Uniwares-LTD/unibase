import { z } from "zod";

import { parsePublicConfig } from "./public";

const serverConfigSchema = z
  .object({
    APP_ENV: z.enum(["local", "staging", "production"]),
    APP_ORIGIN: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV !== "local" && !value.APP_ORIGIN.startsWith("https://")) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "HTTPS is required.",
      });
    }
  });

// Pure parsing is separate from the server-only environment reader so it can be
// tested without importing credentials or the Next.js server-only marker.
export function parseConfig(input: Record<string, string | undefined>) {
  const environment = input.APP_ENV ?? "local";
  const parsed = serverConfigSchema.safeParse({
    APP_ENV: environment,
    APP_ORIGIN:
      input.APP_ORIGIN ??
      (environment === "local" ? "http://localhost:3000" : undefined),
  });

  if (!parsed.success) {
    const keys = [
      ...new Set(parsed.error.issues.map((issue) => issue.path[0])),
    ].sort();
    throw new Error(
      `Invalid server configuration: ${keys.join(", ")}. Check .env.example; non-local APP_ORIGIN must be an HTTPS origin.`,
    );
  }

  return {
    public: parsePublicConfig({
      appName: input.APP_NAME ?? "Base",
      defaultStyle: input.APP_STYLE ?? "classic",
    }),
    server: {
      environment: parsed.data.APP_ENV,
      origin: new URL(parsed.data.APP_ORIGIN).origin,
    },
  };
}
