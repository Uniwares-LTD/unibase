import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { moduleEnabled, moduleIds, type ModuleId } from "../src/lib/project";
import { parseConfig } from "../src/lib/config/schema";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { coreMigrations } from "../src/lib/server/core-migrations";
import {
  runMigrations,
  validateMigrations,
} from "../src/lib/server/migrations";
import { validateServerExtensions } from "../src/lib/server/extensions";
import { serverExtensions } from "../src/project/server";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
async function main() {
  const base = parseConfig(process.env);
  const config = parseDatabaseConfig(process.env, base.server.environment);
  validateServerExtensions([], serverExtensions, moduleIds);
  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  const migrations = [
    ...coreMigrations,
    ...serverExtensions.flatMap((extension) => extension.migrations ?? []),
  ];
  // A typo in an owner would otherwise be skipped silently on every run.
  validateMigrations(migrations, ["core", ...moduleIds]);
  try {
    const report = await runMigrations(
      client.db(config.database),
      migrations,
      (owner) => owner === "core" || moduleEnabled(owner as ModuleId),
    );
    console.log(
      `Migrations applied: ${report.applied.length}; skipped for disabled modules: ${report.skipped.length}.`,
    );
    for (const id of report.applied) console.log(`  applied ${id}`);
    for (const id of report.changed)
      console.warn(
        `  ${id} changed after it was applied; it was not rerun. Add a new migration for further data changes.`,
      );
  } finally {
    await client.close();
  }
}
void main().catch((error: unknown) => {
  // Lock and validation messages are safe; other failures may carry data.
  const message =
    error instanceof Error &&
    /^(Another migration run|Invalid migration|Duplicate migration|Migration .* (?:out of order|has an unknown owner|must belong)|Server extension|Duplicate MCP)/.test(
      error.message,
    )
      ? error.message
      : "Migration failed. Check MongoDB connectivity and the failing migration; no credentials were printed.";
  console.error(message);
  process.exitCode = 1;
});
