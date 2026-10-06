import "server-only";
import { getConfig } from "./config";
import { parseDatabaseConfig } from "../config/database";

export function getDatabaseConfig() {
  return parseDatabaseConfig(
    {
      MONGODB_URI: process.env.MONGODB_URI,
      MONGODB_DATABASE: process.env.MONGODB_DATABASE,
    },
    getConfig().server.environment,
  );
}
