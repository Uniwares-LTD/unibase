import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { parseConfig } from "../src/lib/config/schema";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { createCreditIndexes } from "../src/lib/server/store/credits";
import { createPurchaseIndexes } from "../src/lib/server/store/simulation";
import { createRuntimeIndexes } from "../src/lib/server/store/runtime";
import { createPaymentIndexes } from "../src/lib/server/store/payments";
import { createAiIndexes } from "../src/lib/server/ai/jobs";
import { createAiFileIndexes } from "../src/lib/server/ai/files";
import { createOperationsIndexes } from "../src/lib/server/worker-heartbeat";
import { createWorkspaceIndexes } from "../src/lib/server/workspaces/store";
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const base = parseConfig(process.env);
const config = parseDatabaseConfig(process.env, base.server.environment);
async function main() {
  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client
      .db(config.database)
      .collection("profiles")
      .createIndex({ uid: 1 }, { unique: true, name: "unique_firebase_uid" });
    await client
      .db(config.database)
      .collection("accountAccess")
      .createIndex({ role: 1, status: 1 });
    await client
      .db(config.database)
      .collection("auditEvents")
      .createIndex({ timestamp: -1, _id: -1 });
    await createCreditIndexes(client.db(config.database));
    await createPurchaseIndexes(client.db(config.database));
    await createRuntimeIndexes(client.db(config.database));
    await createPaymentIndexes(client.db(config.database));
    await createAiIndexes(client.db(config.database));
    await createAiFileIndexes(client.db(config.database));
    await createOperationsIndexes(client.db(config.database));
    await createWorkspaceIndexes(client.db(config.database));
    console.log(
      "Profile, access, audit, credit, payment and runtime indexes are ready.",
    );
  } finally {
    await client.close();
  }
}
void main().catch(() => {
  console.error(
    "Could not create application indexes. Check MongoDB connectivity, permissions, and duplicate UIDs. No connection credentials were printed.",
  );
  process.exitCode = 1;
});
