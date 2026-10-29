import "server-only";
import type { Db } from "mongodb";
import type { AccessTarget } from "./context";

export const accessRecords = "diagnosticAccess";
export const ACCESS_RETENTION_SECONDS = 30 * 86400;
/** Sanitized: never the credential, request body or returned content. */
export type AccessRecord = {
  _id: string;
  timestamp: Date;
  requestId: string;
  operatorUid: string;
  grantId: string;
  capability: string;
  outcome: "returned" | "failed";
  status: number;
  targets: AccessTarget[];
};
export async function writeAccessRecord(
  db: Db,
  record: AccessRecord,
  timeoutMS = 3000,
) {
  await db
    .collection<AccessRecord>(accessRecords)
    .insertOne(record, { timeoutMS });
}
export async function createDiagnosticIndexes(db: Db) {
  const records = db.collection(accessRecords);
  await records.createIndex(
    { timestamp: 1 },
    {
      expireAfterSeconds: ACCESS_RETENTION_SECONDS,
      name: "diagnostic_access_retention_30_days",
    },
  );
  await records.createIndex({ operatorUid: 1, timestamp: -1, _id: -1 });
  await records.createIndex({ "targets.accountUid": 1, timestamp: -1 });
}
