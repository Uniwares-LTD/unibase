import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import { difyInitialInputs, orchestratorSchema } from "@/lib/contracts/runs";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";
import { fingerprint } from "../ai/jobs";
import { difyJson } from "./dify-console-client";
import { acquireAppCredential, executionKey } from "./credentials";
import { inspectDifyWorkflow, verifyMcpTools } from "./dify-capabilities";
import type { OrchestratorRecord } from "./orchestrators";
import {
  difyAppCatalog,
  reconcileOrchestratorAvailability,
} from "./orchestrator-lifecycle";

type Env = Record<string, string | undefined>;
type Actor = { uid: string; auth_time: number };
type Registration = {
  _id: string;
  appId: string;
  owner: string;
  until: Date;
  status: "registering" | "ready" | "failed";
  stage: string;
  message?: string;
  orchestratorId?: string;
};
async function publicStatus(
  state: Registration | null,
  db: Db,
  env: Env,
  saved?: OrchestratorRecord,
) {
  if (state?.status === "registering" && state.until > new Date())
    return {
      status: "registering" as const,
      stage: state.stage,
      message: state.message,
    };
  const record =
    saved ??
    (state?.orchestratorId
      ? await db
          .collection<OrchestratorRecord>("orchestrators")
          .findOne({ _id: state.orchestratorId })
      : null);
  if (record?.lifecycle === "unregistered")
    return { status: "unregistered" as const };
  if (record?.availability === "missing")
    return {
      status: "unavailable" as const,
      message: "Workflow is no longer available in Dify.",
    };
  if (record && !record.definition.enabled)
    return {
      status: "disabled" as const,
      message: "Disabled for new Runs. Register to enable it again.",
    };
  if (!state && !record) return { status: "unregistered" as const };
  if (state?.status === "registering" && state.until < new Date())
    return {
      status: "failed" as const,
      stage: state.stage,
      message: "Setup was interrupted. Register again to resume safely.",
    };
  if (state?.status === "ready" || (!state && record)) {
    try {
      if (
        !record?.validated ||
        !record.definition.enabled ||
        !record.definition.credentialId ||
        !(await executionKey(record.definition, db, env))
      )
        throw new Error("Unavailable");
    } catch {
      return {
        status: "failed" as const,
        stage: "Verifying connection",
        message:
          "The saved setup is unavailable. Retry registration to reconnect the app.",
      };
    }
  }
  return {
    status: state?.status ?? ("ready" as const),
    stage: state?.stage ?? "Ready",
    ...(state?.message ? { message: state.message } : {}),
  };
}
function scope(appId: string, env: Env) {
  if (
    !env.DIFY_MANAGEMENT_KEY ||
    !env.DIFY_CONSOLE_URL ||
    !env.DIFY_WORKSPACE_ID ||
    !env.DIFY_BASE_URL ||
    !["live", "fake"].includes(env.DIFY_MODE ?? "")
  )
    throw new AppError(
      "DIFY_REGISTRATION_CONFIGURATION",
      "Configure the Dify execution URL, Console URL, management key and workspace before registering workflows.",
      409,
    );
  if (
    new URL(env.DIFY_CONSOLE_URL).origin !== new URL(env.DIFY_BASE_URL).origin
  )
    throw new AppError(
      "DIFY_REGISTRATION_CONFIGURATION",
      "Dify execution and Console must use the same instance.",
      409,
    );
  z.string().uuid().parse(env.DIFY_WORKSPACE_ID);
  return fingerprint([
    new URL(env.DIFY_CONSOLE_URL).href.replace(/\/$/, ""),
    env.DIFY_WORKSPACE_ID,
    appId,
  ]);
}

export async function discoverDifyOrchestrators(
  db: Db = database(),
  request: typeof difyJson = difyJson,
  env: Env = process.env,
) {
  const registrations = db.collection<Registration>(
    "orchestratorRegistrations",
  );
  const apps: {
    id: string;
    name: string;
    description: string;
    status:
      | "unregistered"
      | "registering"
      | "ready"
      | "failed"
      | "disabled"
      | "unavailable";
    registered: boolean;
    available: boolean;
    orchestratorId?: string;
    stage?: string;
    message?: string;
  }[] = [];
  let catalog: Awaited<ReturnType<typeof difyAppCatalog>> = [];
  let warning: string | undefined;
  const observationStarted = new Date();
  try {
    scope("discovery", env);
    catalog = await difyAppCatalog(request);
    await reconcileOrchestratorAvailability(catalog, db, observationStarted);
  } catch {
    warning =
      "Dify availability could not be checked. Saved registrations can still be disabled or unregistered.";
  }
  const local = await db
    .collection<OrchestratorRecord>("orchestrators")
    .find({ "definition.appId": { $exists: true } })
    .limit(1000)
    .toArray();
  const merged = [
    ...catalog.filter((app) => app.mode === "workflow"),
    ...local
      .filter(
        (r) =>
          r.lifecycle !== "unregistered" &&
          !catalog.some(
            (app) => app.id === r.definition.appId && app.mode === "workflow",
          ),
      )
      .map((r) => ({
        id: r.definition.appId!,
        name: r.definition.name,
        description: r.definition.description,
        mode: "workflow",
      })),
  ];
  const records = warning
    ? []
    : await registrations
        .find({ _id: { $in: merged.map((app) => scope(app.id, env)) } })
        .toArray();
  const rows = await Promise.all(
    merged.map(async (app) => {
      const state = records.find((record) => record.appId === app.id);
      const saved = local.find((r) => r.definition.appId === app.id);
      const registered = !!saved && saved.lifecycle !== "unregistered";
      const status = await publicStatus(state ?? null, db, env, saved);
      return {
        id: app.id,
        name: app.name.slice(0, 100),
        description: (app.description ?? "").slice(0, 1000),
        registered,
        available: catalog.some(
          (item) => item.id === app.id && item.mode === "workflow",
        ),
        ...(registered ? { orchestratorId: saved._id } : {}),
        ...status,
        ...(warning && status.status === "ready"
          ? {
              status: "unavailable" as const,
              message:
                "Could not verify Dify availability. Refresh to check again.",
            }
          : {}),
      };
    }),
  );
  apps.push(...rows);
  return { apps, ...(warning ? { warning } : {}) };
}

export async function registrationStatus(
  appId: string,
  db: Db = database(),
  env: Env = process.env,
) {
  const state = await db
    .collection<Registration>("orchestratorRegistrations")
    .findOne({ _id: scope(z.string().uuid().parse(appId).toLowerCase(), env) });
  return publicStatus(state, db, env);
}

// Read-only workflow checks plus managed key acquisition. Only an app ID is needed.
export async function registerDifyOrchestrator(
  appId: string,
  actor: Actor,
  db: Db = database(),
  providerRequest: typeof difyJson = difyJson,
  env: Env = process.env,
) {
  appId = z.string().uuid().parse(appId).toLowerCase();
  const id = scope(appId, env);
  const owner = randomUUID();
  const registrations = db.collection<Registration>(
    "orchestratorRegistrations",
  );
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      const prior = await registrations.findOne({ _id: id }, { session });
      if (prior?.status === "registering" && prior.until > new Date())
        throw new AppError(
          "DIFY_REGISTRATION_BUSY",
          "This app is already being registered. Refresh to check its progress.",
          409,
        );
      await registrations.updateOne(
        { _id: id },
        {
          $set: {
            appId,
            owner,
            until: new Date(Date.now() + 180000),
            status: "registering",
            stage: "Checking workflow",
            message: "Checking the published app.",
          },
        },
        { session, upsert: true },
      );
      await db.collection<Document & { _id: string }>("auditEvents").insertOne(
        {
          _id: randomUUID(),
          event: "orchestrator-registration",
          actorUid: actor.uid,
          targetUid: actor.uid,
          appId,
          reason:
            "Check and register the published Dify workflow without changing it",
          timestamp: new Date(),
        },
        { session },
      );
    },
    actor.auth_time,
  );
  const deadline = Date.now() + 105000;
  const request: typeof difyJson = (path, options) => {
    const remaining = deadline - Date.now();
    if (remaining < 1000)
      throw new AppError(
        "DIFY_REGISTRATION_TIMEOUT",
        "Setup took too long. Register again to resume the saved setup safely.",
        503,
      );
    return providerRequest(path, {
      ...options,
      timeoutMs: Math.min(30000, remaining),
    });
  };
  const stage = (name: string) =>
    accessTransaction(
      db,
      actor.uid,
      async (session) => {
        const updated = await registrations.updateOne(
          { _id: id, owner, until: { $gt: new Date() } },
          { $set: { stage: name } },
          { session },
        );
        if (!updated.matchedCount)
          throw new AppError(
            "DIFY_REGISTRATION_BUSY",
            "Registration changed. Refresh before continuing.",
            409,
          );
      },
      actor.auth_time,
    );
  try {
    const app = z
      .object({
        name: z.string(),
        description: z.string().nullish(),
        mode: z.literal("workflow"),
      })
      .parse(await request(`/apps/${appId}`, { management: true }));
    const workflow = z
      .object({ id: z.string().uuid(), graph: z.unknown() })
      .safeParse(
        await request(`/apps/${appId}/workflows/publish`, { management: true }),
      );
    if (!workflow.success)
      throw new AppError(
        "DIFY_PUBLICATION_REQUIRED",
        "Publish this Workflow in Dify before registering it.",
        409,
      );
    const fit = inspectDifyWorkflow(workflow.data.graph);
    await verifyMcpTools(fit.mcpTools, request);
    await stage("Connecting app key");
    const credential = await acquireAppCredential(
      appId,
      actor,
      db,
      request,
      env,
    );
    const definition = orchestratorSchema.parse({
      id: `dify-${appId}`,
      name: app.name.trim().slice(0, 100) || "Dify workflow",
      description: (app.description ?? "").slice(0, 1000),
      order: 0,
      appId,
      workflowId: workflow.data.id,
      keyEnv: `DIFY_KEY_AUTO_${appId.replaceAll("-", "_").toUpperCase()}`,
      credentialId: credential.credentialId,
      enabled: true,
      inputs: fit.inputs,
      legacyInputs: fit.legacyInputs,
      pricing: null,
      failureCharging: null,
      recovery: null,
    });
    await stage("Verifying connection and inputs");
    const key = await executionKey(definition, db, env);
    z.object({ mode: z.literal("workflow") }).parse(
      await request("/info", { key }),
    );
    const parameters = await request("/parameters", { key });
    const loadedInputs = difyInitialInputs(parameters);
    if (
      fingerprint(
        z
          .json()
          .parse(
            loadedInputs.filter((field) => !field.name.startsWith("unibase_")),
          ),
      ) !== fingerprint(z.json().parse(definition.inputs))
    )
      throw new AppError(
        "DIFY_REGISTRATION_INPUTS",
        "Published Start inputs and the Service API disagree. Check the publication in Dify, then register again.",
        409,
      );
    const latest = z
      .object({ id: z.string().uuid() })
      .parse(
        await request(`/apps/${appId}/workflows/publish`, { management: true }),
      );
    if (latest.id !== definition.workflowId)
      throw new AppError(
        "DIFY_PUBLICATION_CHANGED",
        "The published workflow changed during registration. Register again.",
        409,
      );
    await stage("Enabling orchestrator");
    await accessTransaction(
      db,
      actor.uid,
      async (session) => {
        const collection = db.collection<OrchestratorRecord>("orchestrators");
        const prior = await collection.findOne(
          { _id: definition.id },
          { session },
        );
        const unchanged =
          prior?.validated &&
          prior.lifecycle !== "unregistered" &&
          prior.availability !== "missing" &&
          fingerprint(z.json().parse(prior.definition)) ===
            fingerprint(z.json().parse(definition));
        if (!unchanged) {
          if (prior)
            await db
              .collection<Document & { _id: string }>("orchestratorVersions")
              .insertOne({ ...prior, _id: randomUUID() }, { session });
          await collection.updateOne(
            { _id: definition.id },
            {
              $set: {
                definition,
                revision: (prior?.revision ?? 0) + 1,
                validated: true,
                updatedAt: new Date(),
              },
              $unset: { lifecycle: "", availability: "" },
            },
            { session, upsert: true },
          );
        }
        const completed = await registrations.updateOne(
          { _id: id, owner, until: { $gt: new Date() } },
          {
            $set: {
              status: "ready",
              stage: "Ready",
              message: "Ready for users.",
              orchestratorId: definition.id,
              until: new Date(0),
            },
          },
          { session },
        );
        if (!completed.matchedCount)
          throw new AppError(
            "DIFY_REGISTRATION_BUSY",
            "Registration changed before it could be enabled. Refresh and retry.",
            409,
          );
      },
      actor.auth_time,
    );
    return {
      appId,
      orchestratorId: definition.id,
      name: definition.name,
      status: "ready" as const,
    };
  } catch (error) {
    const safe =
      error instanceof AppError
        ? error
        : new AppError(
            "DIFY_REGISTRATION_FAILED",
            "Dify returned an unsupported workflow configuration. Registration was not enabled; inspect its workflow and retry.",
            502,
          );
    await registrations.updateOne(
      { _id: id, owner },
      { $set: { status: "failed", message: safe.message, until: new Date(0) } },
    );
    throw safe;
  }
}
