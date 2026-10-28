import { LocalizedValidation } from "@/components/localized-validation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";
import { clientMessages } from "@/lib/server/client-messages";
import { LocaleDirection } from "@/components/locale-direction";
import type { Metadata, Viewport } from "next";
import { BrowserRuntime } from "@/components/browser-runtime";
import { SessionBoundary } from "@/components/session-boundary";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { StyleProvider } from "@/components/style-provider";
import {
  STYLE_COOKIE,
  parseStylePreference,
  resolveStyle,
} from "@/lib/appearance";
import { viewerState } from "@/components/account-menu";
import { AccountMenuControls } from "@/components/account-menu-controls";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { publicSettings } from "@/lib/server/settings";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#98492f",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const { appName } = await publicSettings();
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: (await getTranslations("common"))("description", {
      name: appName,
    }),
    appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read allowlisted configuration at runtime, not frozen into a build.
  await connection();
  const publicConfig = await publicSettings();
  const viewer = await viewerState();
  const { locale, timeZone } = await requestLocale();
  const messages = clientMessages(await getMessages(), "__shell__");
  const preference = parseStylePreference(
    (await cookies()).get(STYLE_COOKIE)?.value,
  );
  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-style={resolveStyle(preference, publicConfig.defaultStyle)}
      suppressHydrationWarning
    >
      <body className="min-h-svh font-sans antialiased">
        <NextIntlClientProvider
          locale={locale}
          timeZone={timeZone}
          messages={messages}
        >
          <LocaleDirection locale={locale}>
            <ThemeProvider
              nonce={(await headers()).get("x-nonce") ?? undefined}
            >
              <StyleProvider
                initialPreference={preference}
                defaultStyle={publicConfig.defaultStyle}
              >
                <BrowserRuntime />
                <LocalizedValidation />
                <SessionBoundary>
                  <AppShell
                    appName={publicConfig.appName}
                    signedIn={viewer.hasSession}
                    accountMenu={<AccountMenuControls {...viewer} />}
                  >
                    {children}
                  </AppShell>
                </SessionBoundary>
              </StyleProvider>
            </ThemeProvider>
          </LocaleDirection>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
