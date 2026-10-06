import { z } from "zod";

export const designStyleSchema = z.enum(["classic", "glass", "soft-blue"]);
export const stylePreferenceSchema = z.enum([
  "default",
  ...designStyleSchema.options,
]);
export type DesignStyle = z.infer<typeof designStyleSchema>;
export type StylePreference = z.infer<typeof stylePreferenceSchema>;
export const STYLE_COOKIE = "unitale-style";

export function parseStylePreference(value: unknown): StylePreference {
  const result = stylePreferenceSchema.safeParse(value);
  return result.success ? result.data : "default";
}

export function resolveStyle(
  preference: StylePreference,
  fallback: DesignStyle,
) {
  return preference === "default" ? fallback : preference;
}
