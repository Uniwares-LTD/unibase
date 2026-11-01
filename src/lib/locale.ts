import { z } from "zod";
import { namespace, project } from "./project";
export const localeSchema = z.enum(["en", "ar"]);
export type Locale = z.infer<typeof localeSchema>;
export function isAdminPath(pathname: string) {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}
export function presentationLocale(
  preference: Locale,
  pathname: string,
): Locale {
  return isAdminPath(pathname) ? "en" : preference;
}
export const localeCookie = namespace("locale");
export const timeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone.");
export const localizationSchema = z.strictObject({
  locale: localeSchema.refine(
    (value) => project.locales.includes(value),
    "Unsupported locale.",
  ),
  timeZone: timeZoneSchema,
});
export function resolveLocale(
  browser: unknown,
  saved: unknown,
  acceptLanguage = "",
): Locale {
  const allowed = (value: unknown): value is Locale =>
    localeSchema.safeParse(value).success &&
    project.locales.includes(value as Locale);
  if (allowed(browser)) return browser;
  if (allowed(saved)) return saved;
  const candidates = acceptLanguage
    .slice(0, 2048)
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((v) => v.trim().startsWith("q="));
      return {
        locale: tag.toLowerCase().split("-")[0],
        q: q ? Number(q.trim().slice(2)) : 1,
        index,
      };
    })
    .filter((v) => Number.isFinite(v.q) && v.q > 0 && v.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (
    (candidates.find((v) => allowed(v.locale))?.locale as Locale) ??
    project.defaultLocale
  );
}
