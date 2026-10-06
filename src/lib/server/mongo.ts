import "server-only";
import { MongoClient } from "mongodb";
import { getDatabaseConfig } from "./database-config";

const globalMongo = globalThis as typeof globalThis & {
  unitaleMongo?: { uri: string; client: MongoClient };
};
export function database() {
  const { mongoUri, database: name } = getDatabaseConfig();
  if (!globalMongo.unitaleMongo || globalMongo.unitaleMongo.uri !== mongoUri) {
    globalMongo.unitaleMongo = {
      uri: mongoUri,
      client: new MongoClient(mongoUri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      }),
    };
  }
  return globalMongo.unitaleMongo.client.db(name);
}
