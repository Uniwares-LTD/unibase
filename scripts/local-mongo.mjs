import manifest from "../project.config.json" with { type: "json" };
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
// Data is kept per project slug: a replica set initialized under another name
// (an earlier slug or another project) never elects a primary under this one.
const relative = `.cache/mongodb/${manifest.slug}`;
const directory = path.resolve(relative);
const legacy = path.resolve(".cache/mongodb-data");
if (!existsSync(directory) && existsSync(legacy))
  console.log(
    `Earlier development data in .cache/mongodb-data is not used. If it belongs to this project's current slug, stop this runner and move it to ${relative}.`,
  );
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
  replSet: {
    count: 1,
    name: `${manifest.slug}-local`,
    storageEngine: "wiredTiger",
  },
});
const client = new MongoClient(mongo.getUri());
await client
  .db(`${manifest.slug.replaceAll("-", "_")}_local`)
  .collection("profiles")
  .createIndex({ uid: 1 }, { unique: true, name: "unique_firebase_uid" });
await client.close();
console.log(
  `Local MongoDB replica set ready on 127.0.0.1:27017; data stays in ${relative}.`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mongo.stop({ doCleanup: false });
    process.exit(0);
  });
