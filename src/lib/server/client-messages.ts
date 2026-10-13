import "server-only";
import sections from "../../../messages/client-sections.json";
import type messages from "../../../messages/en.json";
export function clientMessages(all: typeof messages, pathname: string) {
  const route = sections.routes.find((row) =>
    new RegExp("^" + row.route.replace(/\[[^\]]+\]/g, "[^/]+") + "/?$").test(
      pathname,
    ),
  );
  const wanted = new Set(route?.keys ?? sections.common);
  return {
    locale: all.locale,
    validation: all.validation,
    states: all.states,
    common: all.common,
    ...(pathname.startsWith("/runs") ? { pricing: all.pricing } : {}),
    ...(pathname.startsWith("/admin") ? { fields: all.fields } : {}),
    ui: Object.fromEntries(
      Object.entries(all.ui).filter(([key]) => wanted.has(key)),
    ),
  };
}
