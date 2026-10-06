import type { Metadata, Viewport } from "next";
import { BrowserRuntime } from "@/components/browser-runtime";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { StyleProvider } from "@/components/style-provider";
import {
  STYLE_COOKIE,
  parseStylePreference,
  resolveStyle,
} from "@/lib/appearance";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { getConfig } from "@/lib/server/config";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#98492f",
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const {
    public: { appName },
  } = getConfig();
  return {
    title: { default: appName, template: `%s · ${appName}` },
    description: "Your space in Unitale.",
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
  const { public: publicConfig } = getConfig();
  const preference = parseStylePreference(
    (await cookies()).get(STYLE_COOKIE)?.value,
  );
  return (
    <html
      lang="en"
      data-style={resolveStyle(preference, publicConfig.defaultStyle)}
      suppressHydrationWarning
    >
      <body className="min-h-svh font-sans antialiased">
        <ThemeProvider>
          <StyleProvider
            initialPreference={preference}
            defaultStyle={publicConfig.defaultStyle}
          >
            <BrowserRuntime />
            <AppShell appName={publicConfig.appName}>{children}</AppShell>
          </StyleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
