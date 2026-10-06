import "server-only";
import { getConfig } from "./config";
import { parseAuthConfig } from "../config/auth";

export function getAuthConfig() {
  const { server } = getConfig();
  return parseAuthConfig(
    {
      AUTH_MODE: process.env.AUTH_MODE,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
      FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
      FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    },
    server.environment,
    server.origin,
  );
}
