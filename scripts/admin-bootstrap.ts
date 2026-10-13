import { namespace } from "../src/lib/project";
import { loadEnvConfig } from "@next/env";
import {
  initializeApp,
  applicationDefault,
  deleteApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { MongoClient } from "mongodb";
import { parseAuthConfig } from "../src/lib/config/auth";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { parseConfig } from "../src/lib/config/schema";
import { appointFirstAdmin } from "../src/lib/server/store/access";

loadEnvConfig(process.cwd(), false);
async function main() {
  const uid = process.argv[2];
  if (!uid || uid.length > 128 || process.argv.length !== 3)
    throw new Error("Usage: npm run admin:bootstrap -- FIREBASE_UID");
  const base = parseConfig(process.env);
  const databaseConfig = parseDatabaseConfig(
    process.env,
    base.server.environment,
  );
  const config = parseAuthConfig(
    process.env,
    base.server.environment,
    base.server.origin,
  );
  if (config.server.mode === "emulator")
    process.env.FIREBASE_AUTH_EMULATOR_HOST = config.server.emulatorHost;
  const app = initializeApp(
    {
      projectId: config.public.projectId,
      ...(config.server.mode === "firebase"
        ? { credential: applicationDefault() }
        : {}),
    },
    namespace("bootstrap"),
  );
  const client = new MongoClient(databaseConfig.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    const user = await getAuth(app).getUser(uid);
    if (!user.emailVerified || !user.email || user.disabled)
      throw new Error(
        "The first admin must have a verified, enabled email account.",
      );
    await appointFirstAdmin(
      client.db(databaseConfig.database),
      uid,
      "Explicit first-admin operator appointment",
    );
    console.log("First administrator appointed. The operation was audited.");
  } finally {
    await client.close();
    await deleteApp(app);
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error &&
      ["ADMIN_EXISTS", "ACCOUNT_SUSPENDED"].includes(
        (error as { code?: string }).code ?? "",
      )
      ? error.message
      : "Admin bootstrap failed. Check the command, verified UID, database replica set and provider configuration. No credentials were printed.",
  );
  process.exitCode = 1;
});
