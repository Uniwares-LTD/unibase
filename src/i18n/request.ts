import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";
export default getRequestConfig(async () => {
  const settings = await requestLocale();
  return {
    ...settings,
    messages: (await import(`../../messages/${settings.locale}.json`)).default,
  };
});
