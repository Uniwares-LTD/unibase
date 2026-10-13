"use client";
import { Direction } from "radix-ui";
export function LocaleDirection({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  return (
    <Direction.Provider dir={locale === "ar" ? "rtl" : "ltr"}>
      {children}
    </Direction.Provider>
  );
}
