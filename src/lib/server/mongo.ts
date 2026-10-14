import "server-only";
import { MongoClient } from "mongodb";
import { getDatabaseConfig } from "./database-config";

const globalMongo = globalThis as typeof globalThis & {
  unibaseMongo?: { uri: string; client: MongoClient };
};
export function database() {
  const { mongoUri, database: name } = getDatabaseConfig();
  if (!globalMongo.unibaseMongo || globalMongo.unibaseMongo.uri !== mongoUri) {
    globalMongo.unibaseMongo = {
      uri: mongoUri,
      client: new MongoClient(mongoUri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      }),
    };
  }
  return globalMongo.unibaseMongo.client.db(name);
}
