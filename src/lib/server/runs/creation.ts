import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import { AppError, requireRecentLogin } from "@/lib/auth-policy";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";
import { fingerprint } from "../ai/jobs";
import { difyJson } from "./dify-console-client";
import { starterDsl } from "./dify-starter";
import { registerDifyOrchestrator } from "./registration";

type Creation = {
  _id: string;
  owner: string;
  until: Date;
  started?: boolean;
  appId?: string;
  published?: boolean;
  graphHash?: string;
};
// Journal the irreversible import before sending it. A lost import response must
// never turn a Retry into a second app. Once appId is known, Retry resumes setup.
export async function createDifyOrchestrator(
  key: string,
  actor: { uid: string; auth_time: number },
  db: Db = database(),
  request: typeof difyJson = difyJson,
  env: Record<string, string | undefined> = process.env,
) {
  requireRecentLogin({ auth_time: actor.auth_time, iat: actor.auth_time });
  key = z.string().uuid().parse(key);
  if (
    !env.DIFY_CONSOLE_URL ||
    !env.DIFY_MANAGEMENT_KEY ||
    !env.DIFY_BASE_URL ||
    !env.DIFY_WORKSPACE_ID ||
    env.DIFY_MODE !== "live" ||
    new URL(env.DIFY_BASE_URL).origin !== new URL(env.DIFY_CONSOLE_URL).origin
  )
    throw new AppError(
      "DIFY_CREATION_CONFIGURATION",
      "Configure the Dify connection before creating a workflow.",
      409,
    );
  z.string().uuid().parse(env.DIFY_WORKSPACE_ID);
  const id = fingerprint([
    env.DIFY_CONSOLE_URL,
    env.DIFY_WORKSPACE_ID,
    actor.uid,
    key,
  ]);
  const owner = randomUUID();
  const records = db.collection<Creation>("orchestratorCreations");
  let state: Creation | null = null;
  await accessTransaction(
    db,
    actor.uid,
    async (session) => {
      state = await records.findOne({ _id: id }, { session });
      if (state && state.until > new Date())
        throw new AppError(
          "DIFY_CREATION_BUSY",
          "Creation is still running. Retry shortly to check it.",
          409,
        );
      if (state?.started && !state.appId)
        throw new AppError(
          "DIFY_CREATION_UNKNOWN",
          "Dify did not confirm the new app. Refresh apps and check for Unibase starter before creating another.",
          409,
        );
      await records.updateOne(
        { _id: id },
        { $set: { owner, until: new Date(Date.now() + 240000) } },
        { session, upsert: true },
      );
      if (!state)
        await db.collection<Document>("auditEvents").insertOne(
          {
            event: "orchestrator-creation-request",
            actorUid: actor.uid,
            operationId: id,
            reason: "Create a new MCP and Human Input starter",
            timestamp: new Date(),
          },
          { session },
        );
    },
    actor.auth_time,
  );
  const prior = state as Creation | null;
  let appId = prior?.appId;
  let graphHash = prior?.graphHash;
  const deadline = Date.now() + 60000;
  const creationRequest: typeof difyJson = (path, options = {}) => {
    const remaining = deadline - Date.now();
    if (remaining < 1000)
      throw new AppError(
        "DIFY_CREATION_TIMEOUT",
        "Creation timed out. Retry to resume the saved setup.",
        503,
      );
    return request(path, { ...options, timeoutMs: Math.min(30000, remaining) });
  };
  const checkpoint = async (fields: Partial<Creation>) =>
    accessTransaction(
      db,
      actor.uid,
      async (session) => {
        const result = await records.updateOne(
          { _id: id, owner, until: { $gt: new Date() } },
          { $set: fields },
          { session },
        );
        if (!result.matchedCount)
          throw new AppError(
            "DIFY_CREATION_BUSY",
            "Creation changed. Refresh before continuing.",
            409,
          );
      },
      actor.auth_time,
    );
  try {
    if (!appId) {
      const providers = z
        .array(
          z.object({
            id: z.string().min(1).max(128),
            is_team_authorization: z.boolean(),
            tools: z.array(z.object({ name: z.string() })).max(1000),
          }),
        )
        .max(1000)
        .parse(
          await creationRequest("/workspaces/current/tools/mcp", {
            management: true,
          }),
        );
      const capable = providers.filter(
        (p) =>
          p.is_team_authorization &&
          p.tools.some((t) => t.name === "get_reference_document_v1"),
      );
      const provider =
        capable.find((p) => p.id === "unibase_starter") ?? capable[0];
      if (!provider)
        throw new AppError(
          "DIFY_STARTER_MCP_REQUIRED",
          "Connect Unibase MCP in Dify and synchronize get_reference_document_v1, then create the starter.",
          409,
        );
      const dsl = starterDsl(provider.id);
      graphHash = fingerprint(z.json().parse(dsl.workflow.graph));
      await checkpoint({ started: true, graphHash });
      const imported = z
        .object({ status: z.string(), app_id: z.string().uuid().nullish() })
        .parse(
          await creationRequest("/apps/imports", {
            management: true,
            body: {
              mode: "yaml-content",
              yaml_content: JSON.stringify(dsl),
            },
          }),
        );
      if (
        !imported.app_id ||
        !["completed", "completed-with-warnings"].includes(imported.status)
      )
        throw new AppError(
          "DIFY_CREATION_UNKNOWN",
          "Dify did not confirm the starter import. Check Dify before repeating creation.",
          409,
        );
      appId = imported.app_id;
      await checkpoint({ appId });
      await db.collection<Document>("auditEvents").insertOne({
        event: "orchestrator-creation",
        actorUid: actor.uid,
        appId,
        reason: "Create a new MCP and Human Input starter workflow",
        timestamp: new Date(),
      });
    }
    // A retry must verify its saved app before attempting any setting mutation.
    await creationRequest(`/apps/${appId}`, { management: true });
    if (!prior?.published) {
      await checkpoint({ appId });
      await creationRequest(`/apps/${appId}/site-enable`, {
        management: true,
        body: { enable_site: false },
      });
      const site = z
        .object({ enable_site: z.literal(false) })
        .safeParse(
          await creationRequest(`/apps/${appId}`, { management: true }),
        );
      if (!site.success)
        throw new AppError(
          "DIFY_SITE_CONFIGURATION",
          "Dify did not confirm that the starter Web App was disabled. Retry setup.",
          409,
        );
      const published = await creationRequest(
        `/apps/${appId}/workflows/publish`,
        {
          management: true,
        },
      );
      if (!published) {
        const draft = z.object({ graph: z.json() }).parse(
          await creationRequest(`/apps/${appId}/workflows/draft`, {
            management: true,
          }),
        );
        if (fingerprint(draft.graph) !== graphHash)
          throw new AppError(
            "DIFY_STARTER_CHANGED",
            "The starter draft changed in Dify. Review it there, then Register it.",
            409,
          );
        await checkpoint({ appId }); // Fresh role and live lease immediately before mutation.
        await creationRequest(`/apps/${appId}/workflows/publish`, {
          management: true,
          body: {},
        });
      }
      await checkpoint({ published: true });
    }
    const result = await registerDifyOrchestrator(
      appId,
      actor,
      db,
      request,
      env,
    );
    return { ...result, appId };
  } catch (error) {
    if (error instanceof AppError && error.code === "DIFY_APP_NOT_FOUND")
      throw new AppError(
        "DIFY_CREATION_APP_DELETED",
        "The previous starter was deleted in Dify. Click Create orchestrator again to create a new workflow.",
        409,
      );
    if (
      error instanceof AppError &&
      error.code === "DIFY_IMPORT_REJECTED" &&
      !appId
    )
      await checkpoint({ started: false });
    throw error;
  } finally {
    await records.updateOne(
      { _id: id, owner },
      { $set: { until: new Date(0) } },
    );
  }
}
