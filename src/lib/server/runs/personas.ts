import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession, Document } from "mongodb";
import {
  personaChangeSchema,
  type PersonaFields,
  type Answerer,
} from "@/lib/contracts/personas";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { AppError } from "@/lib/auth-policy";
import { database } from "../mongo";
async function requireAdmin(recent = false) {
  return (await import("../admin")).requireAdmin(recent);
}
import { accessTransaction } from "../store/access";
import { fingerprint } from "../ai/jobs";
import {
  readPersonaCompletion,
  personaCompletionView,
  completionBinding,
  type CompletionSnapshot,
  type CompletionRecord,
} from "./persona-completion-settings";

export type Persona = PersonaFields & {
  _id: string;
  revision: number;
  updatedAt: Date;
};
export type PersonaSnapshot = {
  id: string;
  name: string;
  revision: number;
  instructions: string;
  completion: CompletionSnapshot;
  configurationKey: string;
  pricing: PersonaFields["pricing"];
  maxCalls: number;
  maximum: number;
};
export async function seedPersonas(db: Db = database()) {
  for (const [id, name, instructions] of [
    [
      "10000000-0000-4000-8000-000000000001",
      "Child aged 8–13",
      "Answer as a curious child aged 8–13. Use age-appropriate language and imaginative preferences. Do not claim to be the actual user.",
    ],
    [
      "10000000-0000-4000-8000-000000000002",
      "Parent",
      "Answer as a thoughtful parent considering a child's interests, clarity and suitability. Do not claim to be the actual user.",
    ],
    [
      "10000000-0000-4000-8000-000000000003",
      "Teenager",
      "Answer as a teenager with independent interests and a preference for engaging, respectful content. Do not claim to be the actual user.",
    ],
  ])
    await db.collection<Persona>("personas").updateOne(
      { _id: id },
      {
        $setOnInsert: {
          name,
          description: "Editable example persona",
          instructions,
          enabled: false,
          archived: false,
          pricing: { mode: "fixed", credits: 1 },
          maxCalls: 10,
          revision: 0,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
}
export async function personaChoices(db: Db = database()) {
  await seedPersonas(db);
  const current = await readPersonaCompletion(db);
  let binding;
  try {
    binding = completionBinding(current.settings, current.revision);
  } catch {
    return [];
  }
  const rows = await db
    .collection<Persona>("personas")
    .find({ enabled: true, archived: false })
    .limit(100)
    .toArray();
  return rows.map((row) => ({
    id: row._id,
    name: row.name,
    description: row.description,
    revision: row.revision,
    configurationKey: fingerprint([
      row.revision,
      current.revision,
      current.settings,
      binding,
    ]),
    maxCalls: row.maxCalls,
    maximum: maximumCredits(row.pricing) * row.maxCalls,
  }));
}
export async function personasView() {
  await requireAdmin();
  await seedPersonas();
  const [personas, completion] = await Promise.all([
    database().collection<Persona>("personas").find({}).limit(100).toArray(),
    personaCompletionView(),
  ]);
  return {
    personas: personas.map(({ _id, updatedAt, ...row }) => ({
      id: _id,
      ...row,
      updatedAt: updatedAt.toISOString(),
    })),
    completion,
  };
}
export async function savePersona(input: unknown) {
  const actor = await requireAdmin(true);
  const change = personaChangeSchema.parse(input);
  return accessTransaction(
    database(),
    actor.uid,
    async (session) => {
      const records = database().collection<Persona>("personas");
      const prior = await records.findOne({ _id: change.id }, { session });
      if ((prior?.revision ?? 0) !== change.revision)
        throw new AppError("PERSONA_CONFLICT", "Persona changed. Reload.", 409);
      await records.updateOne(
        { _id: change.id },
        {
          $set: {
            ...change.fields,
            revision: change.revision + 1,
            updatedAt: new Date(),
          },
        },
        { session, upsert: true },
      );
      await database()
        .collection("personaVersions")
        .insertOne(
          {
            personaId: change.id,
            revision: change.revision + 1,
            fields: change.fields,
            timestamp: new Date(),
          },
          { session },
        );
      await database()
        .collection<Document & { _id: string }>("auditEvents")
        .insertOne(
          {
            _id: randomUUID(),
            event: "persona-change",
            actorUid: actor.uid,
            targetUid: actor.uid,
            reason: change.reason,
            personaId: change.id,
            timestamp: new Date(),
          },
          { session },
        );
      return { id: change.id };
    },
    actor.auth_time,
  );
}
export async function snapshotPersona(
  answerer?: Answerer,
  db: Db = database(),
): Promise<PersonaSnapshot | undefined> {
  if (!answerer || answerer.type === "user") return;
  const row = await db.collection<Persona>("personas").findOne({
    _id: answerer.id,
    revision: answerer.revision,
    enabled: true,
    archived: false,
  });
  if (!row)
    throw new AppError(
      "PERSONA_UNAVAILABLE",
      "This persona is unavailable. Reload.",
      409,
    );
  const current = await readPersonaCompletion(db);
  const binding = completionBinding(current.settings, current.revision);
  const configurationKey = fingerprint([
    row.revision,
    current.revision,
    current.settings,
    binding,
  ]);
  if (answerer.configurationKey !== configurationKey)
    throw new AppError(
      "CONFIGURATION_CHANGED",
      "Persona configuration changed. Reload.",
      409,
    );
  return {
    id: row._id,
    name: row.name,
    revision: row.revision,
    instructions: row.instructions,
    completion: { ...current, binding },
    configurationKey,
    pricing: row.pricing,
    maxCalls: row.maxCalls,
    maximum: maximumCredits(row.pricing) * row.maxCalls,
  };
}
export async function guardPersona(
  db: Db,
  snapshot: PersonaSnapshot | undefined,
  session: ClientSession,
) {
  if (!snapshot) return;
  const changed = await db.collection<Persona>("personas").updateOne(
    {
      _id: snapshot.id,
      revision: snapshot.revision,
      enabled: true,
      archived: false,
    },
    { $set: { updatedAt: new Date() } },
    { session },
  );
  if (!changed.matchedCount)
    throw new AppError("PERSONA_UNAVAILABLE", "Persona changed. Reload.", 409);
  const changedCompletion = await db
    .collection<CompletionRecord>("personaCompletionSettings")
    .updateOne(
      {
        _id: "shared",
        revision: snapshot.completion.revision,
        "settings.enabled": true,
      },
      { $inc: { admissionSequence: 1 } },
      { session },
    );
  if (!changedCompletion.matchedCount)
    throw new AppError(
      "PERSONA_UNAVAILABLE",
      "Completion settings changed. Reload.",
      409,
    );
  const binding = completionBinding(
    snapshot.completion.settings,
    snapshot.completion.revision,
  );
  if (binding.fingerprint !== snapshot.completion.binding.fingerprint)
    throw new AppError(
      "PERSONA_UNAVAILABLE",
      "Completion connection changed. Reload.",
      409,
    );
}
