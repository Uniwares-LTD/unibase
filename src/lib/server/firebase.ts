import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getAuthConfig } from "./auth-config";

export function adminAuth() {
  const config = getAuthConfig();
  if (config.server.mode === "emulator") {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.server.emulatorHost;
  }
  const app =
    getApps().find((app) => app.name === "unitale") ??
    initializeApp(
      {
        projectId: config.public.projectId,
        ...(config.server.mode === "firebase"
          ? { credential: applicationDefault() }
          : {}),
      },
      "unitale",
    );
  return getAuth(app);
}
