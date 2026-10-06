import "server-only";

import { parseConfig } from "@/lib/config/schema";

export function getConfig() {
  return parseConfig({
    APP_NAME: process.env.APP_NAME,
    APP_STYLE: process.env.APP_STYLE,
    APP_ENV: process.env.APP_ENV,
    APP_ORIGIN: process.env.APP_ORIGIN,
  });
}
