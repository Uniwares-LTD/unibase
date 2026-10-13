import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { parseConfig } from "../src/lib/config/schema";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { migrateDomainReferences } from "../src/lib/server/domain-migration";
loadEnvConfig(process.cwd());
async function main() {
  const base = parseConfig(process.env);
  const config = parseDatabaseConfig(process.env, base.server.environment);
  const client = new MongoClient(config.mongoUri);
  try {
    console.log(await migrateDomainReferences(client.db(config.database)));
  } finally {
    await client.close();
  }
}
void main().catch(() => {
  console.error("Reference migration failed. No credentials were printed.");
  process.exitCode = 1;
});
