"use client";

import { NextIntlClientProvider } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { presentationLocale, type Locale } from "@/lib/locale";
import type { clientMessages } from "@/lib/server/client-messages";
import { LocaleDirection } from "./locale-direction";

// The root layout persists during navigation. Switch shared shell controls too,
// while leaving the saved account/cookie language preference untouched.
export function ApplicationLocale({
  preference,
  timeZone,
  messages,
  englishMessages,
  children,
}: {
  preference: Locale;
  timeZone: string;
  messages: ReturnType<typeof clientMessages>;
  englishMessages: ReturnType<typeof clientMessages>;
  children: ReactNode;
}) {
  const locale = presentationLocale(preference, usePathname());
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      messages={locale === "en" ? englishMessages : messages}
    >
      <LocaleDirection locale={locale}>{children}</LocaleDirection>
    </NextIntlClientProvider>
  );
}
