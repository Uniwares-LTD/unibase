import { z } from "zod";
import { designStyleSchema } from "../appearance";

export const publicConfigSchema = z.object({
  appName: z.string().trim().min(1).max(60),
  defaultStyle: designStyleSchema.default("classic"),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;

// This module is safe to import into client code: it does not read process.env.
export function parsePublicConfig(input: unknown): PublicConfig {
  const parsed = publicConfigSchema.safeParse(input);
  if (!parsed.success) {
    // Do not include Zod input values or a dump of environment variables.
    throw new Error(
      `Invalid public configuration: ${[...new Set(parsed.error.issues.map((issue) => (issue.path[0] === "defaultStyle" ? "APP_STYLE" : "APP_NAME")))].join(", ")}. Check .env.example.`,
    );
  }
  return parsed.data;
}
