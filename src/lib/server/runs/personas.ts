import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession, Document } from "mongodb";
import {
  personaChangeSchema,
  type PersonaFields,
  type Answerer,
} from "@/lib/contracts/personas";
import { maximumCredits } from "@/lib/config/ai-pricing";
import type { OrchestratorDefinition } from "@/lib/contracts/runs";
import { AppError } from "@/lib/auth-policy";
import { database } from "../mongo";
async function requireAdmin(recent = false) {
  return (await import("../admin")).requireAdmin(recent);
}
import { accessTransaction } from "../store/access";
import { fingerprint } from "../ai/jobs";
import { executionBinding } from "./provider";
import { selectedOrchestrator, type OrchestratorRecord } from "./orchestrators";

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
  responder: OrchestratorDefinition;
  responderRevision: number;
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
          responderId: null,
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
  const rows = await db
    .collection<Persona>("personas")
    .find({ enabled: true, archived: false, responderId: { $ne: null } })
    .limit(100)
    .toArray();
  const choices = [];
  for (const row of rows) {
    const responder = await db
      .collection<OrchestratorRecord>("orchestrators")
      .findOne({
        _id: row.responderId!,
        validated: true,
        "definition.purpose": "responder",
        "definition.enabled": true,
        lifecycle: { $ne: "unregistered" },
        availability: { $ne: "missing" },
      });
    if (!responder) continue;
    try {
      await executionBinding(responder.definition, responder.revision, db);
    } catch {
      continue;
    }
    choices.push({
      id: row._id,
      name: row.name,
      description: row.description,
      revision: row.revision,
      configurationKey: fingerprint([
        row.revision,
        responder.revision,
        responder.definition,
      ]),
      maxCalls: row.maxCalls,
      maximum: maximumCredits(row.pricing) * row.maxCalls,
    });
  }
  return choices;
}
export async function personasView() {
  await requireAdmin();
  await seedPersonas();
  const [personas, responders] = await Promise.all([
    database().collection<Persona>("personas").find({}).limit(100).toArray(),
    database()
      .collection<OrchestratorRecord>("orchestrators")
      .find({
        "definition.purpose": "responder",
        lifecycle: { $ne: "unregistered" },
      })
      .limit(100)
      .toArray(),
  ]);
  return {
    personas: personas.map(({ _id, updatedAt, ...row }) => ({
      id: _id,
      ...row,
      updatedAt: updatedAt.toISOString(),
    })),
    responders: responders.map((r) => ({ id: r._id, name: r.definition.name })),
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
      if (
        change.fields.responderId &&
        !(await database()
          .collection<OrchestratorRecord>("orchestrators")
          .findOne(
            {
              _id: change.fields.responderId,
              "definition.purpose": "responder",
              validated: true,
              lifecycle: { $ne: "unregistered" },
            },
            { session },
          ))
      )
        throw new AppError(
          "RESPONDER_UNAVAILABLE",
          "Select a registered responder.",
          409,
        );
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
  if (!row?.responderId)
    throw new AppError(
      "PERSONA_UNAVAILABLE",
      "This persona is unavailable. Reload.",
      409,
    );
  const responder = await selectedOrchestrator(row.responderId);
  if (
    responder.definition.purpose !== "responder" ||
    answerer.configurationKey !==
      fingerprint([row.revision, responder.revision, responder.definition])
  )
    throw new AppError(
      "CONFIGURATION_CHANGED",
      "Persona configuration changed. Reload.",
      409,
    );
  await executionBinding(responder.definition, responder.revision, db);
  return {
    id: row._id,
    name: row.name,
    revision: row.revision,
    instructions: row.instructions,
    responder: responder.definition,
    responderRevision: responder.revision,
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
  const { guardOrchestratorAdmission } =
    await import("./orchestrator-lifecycle");
  await guardOrchestratorAdmission(
    db,
    {
      _id: snapshot.responder.id,
      revision: snapshot.responderRevision,
      definition: snapshot.responder,
      validated: true,
      updatedAt: new Date(),
    },
    session,
  );
}
