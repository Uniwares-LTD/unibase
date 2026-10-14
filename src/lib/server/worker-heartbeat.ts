import "server-only";
import { project } from "../project";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "mongodb";

export type WorkerKind = "payment" | "ai";
export type WorkerHeartbeat = {
  _id: string;
  kind: WorkerKind;
  commit: string;
  updatedAt: Date;
  state: "ok" | "error" | "disabled";
};
export const WORKER_MAX_AGE_MS = 300_000;
const heartbeatPath = (kind: WorkerKind) =>
  join(tmpdir(), `${project.slug}-${kind}-heartbeat.json`);
export function healthyHeartbeat(
  value: Pick<WorkerHeartbeat, "updatedAt" | "state">,
  now = Date.now(),
) {
  const age = now - new Date(value.updatedAt).getTime();
  return (
    ["ok", "disabled"].includes(value.state) &&
    age >= 0 &&
    age < WORKER_MAX_AGE_MS
  );
}
export function workerHeartbeat(db: Db, kind: WorkerKind) {
  const instance = randomUUID();
  return async (state: WorkerHeartbeat["state"]) => {
    const record: WorkerHeartbeat = {
      _id: `${kind}:${instance}`,
      kind,
      state,
      commit: process.env.RELEASE_COMMIT ?? "local",
      updatedAt: new Date(),
    };
    await db
      .collection<WorkerHeartbeat>("workerHeartbeats")
      .replaceOne({ _id: record._id }, record, {
        upsert: true,
        timeoutMS: 5000,
      });
    const path = heartbeatPath(kind);
    await writeFile(`${path}.tmp`, JSON.stringify(record), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
}
export async function checkWorkerHeartbeat(kind: WorkerKind) {
  const record = JSON.parse(
    await readFile(heartbeatPath(kind), "utf8"),
  ) as WorkerHeartbeat;
  if (record.kind !== kind || !healthyHeartbeat(record))
    throw new Error("Worker unavailable");
}
export async function createOperationsIndexes(db: Db) {
  await db
    .collection("workerHeartbeats")
    .createIndex({ updatedAt: 1 }, { expireAfterSeconds: 86400 });
  await db.collection("cleanupReports").createIndex({ createdAt: -1 });
  await db.collection("paymentReviews").createIndex({ createdAt: -1 });
  await db.collection("aiJobs").createIndex({ status: 1, createdAt: 1 });
  await db.collection("aiJobs").createIndex({ status: 1, updatedAt: 1 });
}
