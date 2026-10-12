import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, Document, ClientSession } from "mongodb";
import { AppError, requireRecentLogin } from "@/lib/auth-policy";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";
import { difyJson } from "./dify-console-client";
import { executionKey } from "./credentials";
import type { OrchestratorRecord } from "./orchestrators";

const providerApp = z.object({
  id: z.string().uuid(),
  name: z.string().max(1000),
  description: z.string().max(10000).nullish(),
  mode: z.string(),
});
export async function difyAppCatalog(request: typeof difyJson = difyJson) {
  const apps: z.infer<typeof providerApp>[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = z
      .object({
        data: z.array(providerApp).max(100),
        has_more: z.boolean().optional(),
      })
      .parse(
        await request(`/apps?page=${page}&limit=100`, { management: true }),
      );
    apps.push(...result.data);
    if (!result.has_more) return apps;
  }
  throw new AppError(
    "DIFY_CATALOG_INCOMPLETE",
    "The Dify app list is incomplete. Availability was not changed.",
    503,
  );
}
export async function markOrchestratorMissing(
  record: OrchestratorRecord,
  db: Db = database(),
) {
  await db.collection<OrchestratorRecord>("orchestrators").updateOne(
    {
      _id: record._id,
      revision: record.revision,
      availability: { $ne: "missing" },
      lifecycle: { $ne: "unregistered" },
    },
    {
      $set: { availability: "missing", updatedAt: new Date() },
      $inc: { revision: 1 },
    },
  );
}
export async function reconcileOrchestratorAvailability(
  apps: z.infer<typeof providerApp>[],
  db: Db = database(),
  observationStarted = new Date(),
) {
  const records = await db
    .collection<OrchestratorRecord>("orchestrators")
    .find({
      "definition.appId": { $exists: true },
      lifecycle: { $ne: "unregistered" },
      updatedAt: { $lte: observationStarted },
    })
    .limit(1000)
    .toArray();
  const present = new Set(
    apps.filter((a) => a.mode === "workflow").map((a) => a.id),
  );
  await Promise.all(
    records
      .filter((r) => !present.has(r.definition.appId!))
      .map((r) => markOrchestratorMissing(r, db)),
  );
}
export async function verifyOrchestratorAvailable(
  record: OrchestratorRecord,
  db: Db = database(),
  request: typeof difyJson = difyJson,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.DIFY_MODE !== "live") return;
  try {
    if (
      record.definition.appId &&
      env.DIFY_CONSOLE_URL &&
      env.DIFY_MANAGEMENT_KEY
    ) {
      z.object({ mode: z.literal("workflow") }).parse(
        await request(`/apps/${record.definition.appId}`, { management: true }),
      );
    } else {
      const key = await executionKey(record.definition, db, env);
      z.object({ mode: z.literal("workflow") }).parse(
        await request("/info", { key }),
      );
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "DIFY_APP_NOT_FOUND") {
      await markOrchestratorMissing(record, db);
      throw new AppError(
        "ORCHESTRATOR_UNAVAILABLE",
        "This workflow is no longer available in Dify. Choose another orchestrator.",
        409,
      );
    }
    throw new AppError(
      "ORCHESTRATOR_CHECK_FAILED",
      "Could not verify this workflow in Dify. Try again shortly.",
      503,
    );
  }
}
export async function changeOrchestrator(
  action: "disable" | "unregister",
  id: string,
  actor: { uid: string; auth_time: number },
  db: Db = database(),
) {
  requireRecentLogin({ auth_time: actor.auth_time, iat: actor.auth_time });
  id = z.string().min(1).max(100).parse(id);
  return accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const collection = db.collection<OrchestratorRecord>("orchestrators");
      const record = await collection.findOne({ _id: id }, { session });
      if (!record)
        throw new AppError(
          "ORCHESTRATOR_UNAVAILABLE",
          "This orchestrator is not registered.",
          404,
        );
      const already =
        action === "unregister"
          ? record.lifecycle === "unregistered"
          : !record.definition.enabled;
      if (!already) {
        await db
          .collection<Document & { _id: string }>("orchestratorVersions")
          .insertOne({ ...record, _id: randomUUID() }, { session });
        await collection.updateOne(
          { _id: id },
          {
            $set: {
              "definition.enabled": false,
              ...(action === "unregister"
                ? { lifecycle: "unregistered" as const }
                : {}),
              updatedAt: new Date(),
            },
            $inc: { revision: 1 },
          },
          { session },
        );
      }
      // Fence a concurrent Register so its final transaction cannot undo this action.
      await db.collection("orchestratorRegistrations").updateMany(
        {
          $or: [
            { orchestratorId: id },
            ...(record.definition.appId
              ? [{ appId: record.definition.appId }]
              : []),
          ],
        },
        {
          $set: {
            owner: randomUUID(),
            until: new Date(0),
            status: "failed",
            stage: action === "disable" ? "Disabled" : "Unregistered",
            message: "Registration was stopped by an administrator.",
          },
        },
        { session },
      );
      if (!already)
        await db
          .collection<Document & { _id: string }>("auditEvents")
          .insertOne(
            {
              _id: randomUUID(),
              event: `orchestrator-${action}`,
              actorUid: actor.uid,
              targetUid: actor.uid,
              orchestratorId: id,
              reason:
                action === "disable"
                  ? "Stop new Runs"
                  : "Unregister from Unibase; preserve history and Dify",
              timestamp: new Date(),
            },
            { session },
          );
      return {
        status:
          action === "disable"
            ? ("disabled" as const)
            : ("unregistered" as const),
      };
    },
    actor.auth_time,
  );
}
export async function guardOrchestratorAdmission(
  db: Db,
  record: OrchestratorRecord,
  session: ClientSession,
) {
  const changed = await db
    .collection<OrchestratorRecord>("orchestrators")
    .updateOne(
      {
        _id: record._id,
        revision: record.revision,
        "definition.enabled": true,
        validated: true,
        lifecycle: { $ne: "unregistered" },
        availability: { $ne: "missing" },
      },
      { $inc: { admissionSequence: 1 } },
      { session },
    );
  if (!changed.matchedCount)
    throw new AppError(
      "ORCHESTRATOR_UNAVAILABLE",
      "This orchestrator changed or was disabled. Reload before starting.",
      409,
    );
}
