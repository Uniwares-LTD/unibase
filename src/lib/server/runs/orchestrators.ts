import type { Document } from "mongodb";
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  orchestratorSchema,
  orchestratorUpdateSchema,
  type OrchestratorDefinition,
} from "@/lib/contracts/runs";
import { database } from "../mongo";
import { requireAdmin } from "../admin";
import { accessTransaction } from "../store/access";
import { readSettings } from "../settings";
import { fingerprint } from "../ai/jobs";

export type OrchestratorRecord = {
  _id: string;
  revision: number;
  definition: OrchestratorDefinition;
  validated: boolean;
  updatedAt: Date;
};
export async function seedOrchestrators() {
  const raw = z
    .array(orchestratorSchema)
    .max(100)
    .parse(JSON.parse(process.env.DIFY_ORCHESTRATORS_JSON || "[]"));
  if (process.env.DIFY_MODE === "fake" && !raw.length)
    raw.push({
      id: "demo",
      name: "Demo orchestrator",
      description: "Local structured UI and durable run fixture.",
      order: 0,
      keyEnv: "DIFY_KEY_DEMO",
      enabled: true,
      inputs: [
        {
          name: "prompt",
          label: "What would you like to create?",
          kind: "paragraph",
          required: true,
          options: [],
        },
      ],
      pricing: null,
      recovery: { version: "1", stages: ["draft"], diagnostic: true },
    });
  for (const definition of raw)
    await database()
      .collection<OrchestratorRecord>("orchestrators")
      .updateOne(
        { _id: definition.id },
        {
          $setOnInsert: {
            revision: 0,
            definition,
            validated: process.env.DIFY_MODE === "fake",
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
}
export async function orchestrators(admin = false) {
  await seedOrchestrators();
  const settings = await readSettings();
  const rows = await database()
    .collection<OrchestratorRecord>("orchestrators")
    .find(admin ? {} : { "definition.enabled": true, validated: true })
    .sort({ "definition.order": 1, _id: 1 })
    .limit(100)
    .toArray();
  return rows.map((row) => {
    const d = row.definition;
    const ready =
      process.env.DIFY_MODE === "fake" ||
      (!!process.env[d.keyEnv] && !!d.workflowId);
    const configurationKey = fingerprint([row.revision, settings.revision, d]);
    return admin
      ? {
          ...d,
          revision: row.revision,
          validated: row.validated,
          ready,
          configurationKey,
        }
      : {
          id: d.id,
          name: d.name,
          description: d.description,
          inputs: d.inputs,
          pricing: d.pricing ?? settings.settings.runs.pricing,
          failureCharging:
            d.failureCharging ?? settings.settings.runs.failureCharging,
          configurationKey,
          ready: ready && settings.settings.runs.enabled,
          recovery: d.recovery,
        };
  });
}
export async function selectedOrchestrator(id: string) {
  await seedOrchestrators();
  const row = await database()
    .collection<OrchestratorRecord>("orchestrators")
    .findOne({ _id: id });
  if (!row || !row.validated || !row.definition.enabled)
    throw new AppError(
      "ORCHESTRATOR_UNAVAILABLE",
      "This orchestrator is unavailable.",
      409,
    );
  return row;
}
export async function saveOrchestrator(input: unknown, validated = false) {
  const actor = await requireAdmin(true);
  const parsed = orchestratorUpdateSchema.parse(input);
  const db = database();
  if (parsed.definition.enabled && !validated)
    throw new AppError(
      "VALIDATION_REQUIRED",
      "Validate the orchestrator before enabling it.",
      409,
    );
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const collection = db.collection<OrchestratorRecord>("orchestrators");
      const prior = await collection.findOne(
        { _id: parsed.definition.id },
        { session },
      );
      if ((prior?.revision ?? 0) !== parsed.revision)
        throw new AppError(
          "ORCHESTRATOR_CONFLICT",
          "Configuration changed. Reload.",
          409,
        );
      if (prior)
        await db
          .collection<Document & { _id: string }>("orchestratorVersions")
          .insertOne({ ...prior, _id: randomUUID() }, { session });
      await collection.updateOne(
        { _id: parsed.definition.id },
        {
          $set: {
            definition: parsed.definition,
            revision: parsed.revision + 1,
            validated,
            updatedAt: new Date(),
          },
        },
        { session, upsert: true },
      );
      await db.collection<Document & { _id: string }>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "orchestrator-save",
          actorUid: actor.uid,
          targetUid: actor.uid,
          reason: parsed.reason,
          timestamp: new Date(),
        },
        { session },
      );
    },
    actor.auth_time,
  );
  return { saved: true };
}
