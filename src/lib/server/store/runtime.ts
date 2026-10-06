import "server-only";
import type { Db } from "mongodb";
import type { RuntimeRecord } from "../../log-policy";
export type StoredRuntimeRecord = Omit<RuntimeRecord, "timestamp"> & {
  _id: string;
  timestamp: Date;
};

export async function writeRuntimeRecord(
  db: Db,
  record: RuntimeRecord,
  timeoutMS: number,
) {
  await db.collection<StoredRuntimeRecord>("runtimeLogs").insertOne(
    {
      _id: crypto.randomUUID(),
      timestamp: new Date(record.timestamp),
      event: record.event,
      severity: record.severity,
      ...(record.status === undefined ? {} : { status: record.status }),
      ...(record.durationMs === undefined
        ? {}
        : { durationMs: record.durationMs }),
      ...(record.requestId === undefined
        ? {}
        : { requestId: record.requestId }),
    },
    { timeoutMS },
  );
}
export async function createRuntimeIndexes(db: Db) {
  await db
    .collection("runtimeLogs")
    .createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: 30 * 86400, name: "runtime_retention_30_days" },
    );
  await db.collection("runtimeLogs").createIndex({ timestamp: -1, _id: -1 });
  await db
    .collection("runtimeLogs")
    .createIndex({ severity: 1, timestamp: -1, _id: -1 });
  await db
    .collection("runtimeLogs")
    .createIndex({ event: 1, timestamp: -1, _id: -1 });
  await db.collection("runtimeLogs").createIndex({ requestId: 1 });
  await db
    .collection("auditEvents")
    .createIndex({ actorUid: 1, timestamp: -1, _id: -1 });
  await db
    .collection("auditEvents")
    .createIndex({ targetUid: 1, timestamp: -1, _id: -1 });
}
