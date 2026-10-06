"use client";
import { getApps, initializeApp } from "firebase/app";
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  getRedirectResult,
  initializeAuth,
  browserPopupRedirectResolver,
} from "firebase/auth";
import type { FirebaseBrowserConfig } from "../config/auth";

let ready: Promise<ReturnType<typeof getAuth>> | undefined;
let redirectResult: ReturnType<typeof getRedirectResult> | undefined;
export async function redirectCredential(config: FirebaseBrowserConfig) {
  const auth = await browserAuth(config);
  redirectResult ??= getRedirectResult(auth);
  return redirectResult;
}
export function browserAuth(config: FirebaseBrowserConfig) {
  ready ??= (async () => {
    const existing = getApps().find((app) => app.name === "unitale-browser");
    const app = existing ?? initializeApp(config, "unitale-browser");
    // Select persistence before Firebase processes a returning redirect.
    const auth = existing
      ? getAuth(app)
      : initializeAuth(app, {
          persistence: browserSessionPersistence,
          popupRedirectResolver: browserPopupRedirectResolver,
        });
    if (config.emulatorUrl && !auth.emulatorConfig)
      connectAuthEmulator(auth, config.emulatorUrl, { disableWarnings: true });
    // Survive the OAuth redirect in this tab only; cleared after session exchange.
    await auth.authStateReady();
    return auth;
  })();
  return ready;
}
