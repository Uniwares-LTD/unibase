import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";
import { headers } from "next/headers";
import { presentationLocale } from "@/lib/locale";
export default getRequestConfig(async () => {
  const settings = await requestLocale();
  const locale = presentationLocale(
    settings.locale,
    (await headers()).get("x-pathname") ?? "",
  );
  return {
    ...settings,
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
