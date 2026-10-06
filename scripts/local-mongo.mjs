import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { mkdirSync } from "node:fs";
import path from "node:path";
const directory = path.resolve(".cache/mongodb-data");
mkdirSync(directory, { recursive: true });
const mongo = await MongoMemoryReplSet.create({
  binary: { downloadDir: path.resolve(".cache/mongodb-binaries") },
  instanceOpts: [
    {
      ip: "127.0.0.1",
      port: 27017,
      dbPath: directory,
      storageEngine: "wiredTiger",
    },
  ],
  replSet: { count: 1, name: "unitale-local", storageEngine: "wiredTiger" },
});
const client = new MongoClient(mongo.getUri());
await client
  .db("unitale_local")
  .collection("profiles")
  .createIndex({ uid: 1 }, { unique: true, name: "unique_firebase_uid" });
await client.close();
console.log(
  "Local MongoDB replica set ready on 127.0.0.1:27017; existing data stays in .cache/mongodb-data.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mongo.stop({ doCleanup: false });
    process.exit(0);
  });
