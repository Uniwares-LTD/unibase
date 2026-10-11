import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import type { OrchestratorDefinition } from "@/lib/contracts/runs";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";
import { difyJson } from "./dify-console-client";

type Env = Record<string, string | undefined>;
type Actor = { uid: string; auth_time: number };
type Credential = {
  _id: string;
  scope: string;
  appId: string;
  providerKeyId: string;
  ciphertext: string;
  iv: string;
  tag: string;
  createdAt: Date;
};
type Acquisition = {
  _id: string;
  owner: string;
  until: Date;
  creationStarted: boolean;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const tokenSchema = z.string().regex(/^app-[A-Za-z0-9_-]{10,256}$/);
const keySchema = z.object({
  id: z.string().uuid(),
  token: z.string().max(300),
});

function scope(env: Env) {
  const workspace = z.string().uuid().safeParse(env.DIFY_WORKSPACE_ID);
  if (!workspace.success || !env.DIFY_CONSOLE_URL || !env.DIFY_BASE_URL)
    throw new AppError(
      "DIFY_NOT_CONFIGURED",
      "Configure Dify execution and management connections before connecting an app.",
      409,
    );
  try {
    const consoleUrl = new URL(env.DIFY_CONSOLE_URL);
    const serviceUrl = new URL(env.DIFY_BASE_URL);
    if (consoleUrl.origin !== serviceUrl.origin) throw new Error();
    return digest([
      consoleUrl.href.replace(/\/$/, ""),
      serviceUrl.href.replace(/\/$/, ""),
      workspace.data,
    ]);
  } catch {
    throw new AppError(
      "DIFY_CONFIGURATION",
      "Dify execution and management must use the same instance.",
      409,
    );
  }
}
function encryptionKey(env: Env, credentialScope: string) {
  const explicit = env.DIFY_CREDENTIAL_ENCRYPTION_KEY;
  if (explicit && !/^[a-fA-F0-9]{64}$/.test(explicit))
    throw new AppError(
      "DIFY_CONFIGURATION",
      "DIFY_CREDENTIAL_ENCRYPTION_KEY must contain 64 hexadecimal characters.",
      503,
    );
  const secret = explicit
    ? Buffer.from(explicit, "hex")
    : env.DIFY_MANAGEMENT_KEY;
  if (!secret)
    throw new AppError(
      "DIFY_CONFIGURATION",
      "The server credential encryption secret is unavailable.",
      503,
    );
  return Buffer.from(
    hkdfSync(
      "sha256",
      secret,
      credentialScope,
      "unibase:dify-app-credentials:v1",
      32,
    ),
  );
}
function decrypt(record: Credential, env: Env) {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(env, record.scope),
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(
        JSON.stringify([
          record._id,
          record.scope,
          record.appId,
          record.providerKeyId,
        ]),
      ),
    );
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return tokenSchema.parse(
      Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new AppError(
      "DIFY_CREDENTIAL_UNAVAILABLE",
      "The saved app credential cannot be read. Restore the encryption secret or reconnect this app.",
      503,
    );
  }
}

// No network calls or key creation on execution/read paths.
export async function executionKey(
  definition: OrchestratorDefinition,
  db: Db = database(),
  env: Env = process.env,
) {
  if (!definition.credentialId) return env[definition.keyEnv];
  const record = await db.collection<Credential>("difyCredentials").findOne({
    _id: definition.credentialId,
    appId: definition.appId,
    scope: scope(env),
  });
  if (!record)
    throw new AppError(
      "DIFY_CREDENTIAL_UNAVAILABLE",
      "The saved app credential is unavailable for this Dify app and workspace. Reconnect the app.",
      409,
    );
  return decrypt(record, env);
}

// Called only after fresh administrator authorization by manageDify.
export async function acquireAppCredential(
  appId: string,
  actor: Actor,
  db: Db = database(),
  request: typeof difyJson = difyJson,
  env: Env = process.env,
) {
  appId = z.string().uuid().parse(appId);
  const credentialScope = scope(env);
  // Fail before any provider mutation if encryption cannot be initialized.
  const encryption = encryptionKey(env, credentialScope);
  const operationId = digest([credentialScope, appId]);
  const operations = db.collection<Acquisition>("difyCredentialAcquisitions");
  const owner = randomUUID();
  const now = new Date();
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const prior = await operations.findOne({ _id: operationId }, { session });
      if (prior && prior.until > now)
        throw new AppError(
          "DIFY_CREDENTIAL_BUSY",
          "This app is already being connected. Wait, then try again.",
          409,
        );
      await operations.updateOne(
        { _id: operationId },
        {
          $set: { owner, until: new Date(now.getTime() + 120000) },
          $setOnInsert: { creationStarted: false },
        },
        { session, upsert: true },
      );
      await db.collection<Document & { _id: string }>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "dify-credential-connect",
          actorUid: actor.uid,
          targetUid: actor.uid,
          reason: "Fetch an existing app key before creating one",
          appId,
          timestamp: now,
        },
        { session },
      );
    },
    actor.auth_time,
  );
  try {
    // Confirm the app belongs to the configured workspace and is a Workflow.
    const app = z
      .object({ mode: z.literal("workflow") })
      .safeParse(await request(`/apps/${appId}`, { management: true }));
    if (!app.success)
      throw new AppError(
        "DIFY_APP_UNSUPPORTED",
        "Select a Workflow app from this Dify workspace.",
        409,
      );
    const listed = z
      .object({ data: z.array(keySchema).max(10) })
      .safeParse(
        await request(`/apps/${appId}/api-keys`, { management: true }),
      );
    if (!listed.success)
      throw new AppError(
        "DIFY_INVALID_RESPONSE",
        "Dify returned an invalid app key list.",
        502,
      );
    let selected = listed.data.data.find(
      (key) => tokenSchema.safeParse(key.token).success,
    );
    let source: "existing" | "created" = "existing";
    if (!selected) {
      const operation = await operations.findOne({ _id: operationId, owner });
      if (!operation || operation.creationStarted)
        throw new AppError(
          "DIFY_KEY_CREATION_UNKNOWN",
          "A previous key creation was not confirmed. Inspect this app’s keys in Dify before trying again; no additional key was created.",
          409,
        );
      await accessTransaction(
        db,
        actor.uid,
        async (session) => {
          await operations.updateOne(
            { _id: operationId, owner },
            { $set: { creationStarted: true } },
            { session },
          );
        },
        actor.auth_time,
      );
      let createdResponse: unknown;
      try {
        createdResponse = await request(`/apps/${appId}/api-keys`, {
          management: true,
          body: {},
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "DIFY_KEY_CREATION_REJECTED"
        )
          await operations.updateOne(
            { _id: operationId, owner },
            { $set: { creationStarted: false } },
          );
        throw error;
      }
      const created = keySchema.safeParse(createdResponse);
      if (
        !created.success ||
        !tokenSchema.safeParse(created.data.token).success
      )
        throw new AppError(
          "DIFY_KEY_CREATION_UNKNOWN",
          "Dify did not return a usable app key. Inspect the app’s keys before trying again.",
          502,
        );
      selected = created.data;
      source = "created";
    }
    const id = digest([
      credentialScope,
      appId,
      selected.id,
      digest(selected.token),
    ]);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryption, iv);
    cipher.setAAD(
      Buffer.from(JSON.stringify([id, credentialScope, appId, selected.id])),
    );
    const ciphertext = Buffer.concat([
      cipher.update(selected.token, "utf8"),
      cipher.final(),
    ]);
    await accessTransaction(
      db,
      actor.uid,
      async (session) => {
        await db.collection<Credential>("difyCredentials").updateOne(
          { _id: id },
          {
            $set: {
              scope: credentialScope,
              appId,
              providerKeyId: selected.id,
              ciphertext: ciphertext.toString("base64"),
              iv: iv.toString("base64"),
              tag: cipher.getAuthTag().toString("base64"),
              createdAt: new Date(),
            },
          },
          { session, upsert: true },
        );
        await operations.updateOne(
          { _id: operationId, owner },
          { $set: { creationStarted: false } },
          { session },
        );
      },
      actor.auth_time,
    );
    return { credentialId: id, source };
  } finally {
    await operations.updateOne(
      { _id: operationId, owner },
      { $set: { until: new Date(0) } },
    );
  }
}
