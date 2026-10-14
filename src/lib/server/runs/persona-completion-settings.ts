import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import {
  personaCompletionSchema,
  personaCompletionChangeSchema,
  type PersonaCompletionSettings,
} from "@/lib/contracts/personas";
import { parsePersonaCompletionConfig } from "@/lib/config/persona-completion";
import { AppError } from "@/lib/auth-policy";
import { fingerprint, type BindingSnapshot } from "../ai/jobs";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";

export type CompletionSnapshot = {
  revision: number;
  settings: PersonaCompletionSettings;
  binding: BindingSnapshot;
};
export type CompletionRecord = {
  _id: string;
  revision: number;
  settings: PersonaCompletionSettings;
};
export async function readPersonaCompletion(db: Db = database()) {
  const collection = db.collection<CompletionRecord>(
    "personaCompletionSettings",
  );
  await collection.updateOne(
    { _id: "shared" },
    {
      $setOnInsert: {
        revision: 0,
        settings: personaCompletionSchema.parse({}),
      },
    },
    { upsert: true },
  );
  const row = (await collection.findOne({ _id: "shared" }))!;
  return {
    revision: row.revision,
    settings: personaCompletionSchema.parse(row.settings),
  };
}
export function completionBinding(
  settings: PersonaCompletionSettings,
  revision: number,
): BindingSnapshot {
  let config;
  try {
    config = parsePersonaCompletionConfig(process.env);
  } catch {
    throw new AppError(
      "AI_CONFIGURATION",
      "The Persona completion connection is unavailable. Check its server configuration.",
      503,
    );
  }
  if (!settings.enabled || !settings.model || config.mode === "disabled")
    throw new AppError(
      "PERSONA_UNAVAILABLE",
      "Persona completions are not configured or enabled.",
      409,
    );
  return {
    name: "persona-completion",
    revision: String(revision),
    kind: "completion",
    mode: config.mode,
    fingerprint: fingerprint([
      config.mode,
      config.baseUrl,
      config.apiKey,
      revision,
      settings,
    ]),
  };
}
export async function personaCompletionView(db: Db = database()) {
  const current = await readPersonaCompletion(db);
  let ready = false;
  let connectionReady = false;
  try {
    connectionReady =
      parsePersonaCompletionConfig(process.env).mode !== "disabled";
    completionBinding(current.settings, current.revision);
    ready = true;
  } catch {
    /* Only readiness is public to administrators; never serialize secrets. */
  }
  return { ...current, ready, connectionReady };
}
export async function savePersonaCompletion(input: unknown) {
  const { requireAdmin } = await import("../admin");
  const actor = await requireAdmin(true);
  const change = personaCompletionChangeSchema.parse(input);
  const db = database();
  await readPersonaCompletion(db);
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const changed = await db
        .collection<CompletionRecord>("personaCompletionSettings")
        .updateOne(
          { _id: "shared", revision: change.revision },
          { $set: { settings: change.settings }, $inc: { revision: 1 } },
          { session },
        );
      if (!changed.matchedCount)
        throw new AppError(
          "PERSONA_CONFLICT",
          "Completion settings changed. Reload.",
          409,
        );
      await db.collection("personaCompletionVersions").insertOne(
        {
          revision: change.revision + 1,
          settings: change.settings,
          timestamp: new Date(),
        },
        { session },
      );
      await db.collection<Document & { _id: string }>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "persona-completion-change",
          actorUid: actor.uid,
          targetUid: actor.uid,
          reason: change.reason,
          timestamp: new Date(),
        },
        { session },
      );
    },
    actor.auth_time,
  );
  return { revision: change.revision + 1 };
}
