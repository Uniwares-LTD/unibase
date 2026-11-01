import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { database } from "../mongo";
import { accessTransaction } from "../store/access";
import { fingerprint } from "../ai/jobs";
import { difyJson } from "./dify-console-client";
import { orchestratorTemplate } from "./templates";
import {
  orchestratorTemplateIdSchema,
  type OrchestratorTemplateId,
} from "@/lib/contracts/orchestrator-templates";
import { registerDifyOrchestrator } from "./registration";
import { parseDocument } from "yaml";
import { inspectDifyWorkflow } from "./dify-capabilities";
import { selectedWorkflowVersion } from "./workflow-versions";
import type { WorkflowVersionSelection } from "@/lib/contracts/workflow-versions";
import {
  bindEnvironmentGraph,
  ensureEnvironmentMcp,
  environmentIdentity,
  recordAppOwnership,
  tagOwnedApp,
  verifyDestinationResources,
} from "./environment-binding";
import { tools } from "../mcp/tools";

type Creation = {
  _id: string;
  owner: string;
  until: Date;
  started?: boolean;
  appId?: string;
  published?: boolean;
  graphHash?: string;
  templateId?: OrchestratorTemplateId;
  source?: { appId: string; workflowId: string };
  tagged?: boolean;
};
// Journal the irreversible import before sending it. A lost import response must
// never turn a Retry into a second app. Once appId is known, Retry resumes setup.
export async function createDifyOrchestrator(
  key: string,
  actor: { uid: string; auth_time: number },
  db: Db = database(),
  request: typeof difyJson = difyJson,
  env: Record<string, string | undefined> = process.env,
  templateId: OrchestratorTemplateId = "document-summary",
  source?: { appId: string; selection: WorkflowVersionSelection },
) {
  key = z.string().uuid().parse(key);
  templateId = orchestratorTemplateIdSchema.parse(templateId);
  let template: ReturnType<typeof orchestratorTemplate>;
  const identity = environmentIdentity(env);
  const provenance = source
    ? {
        appId: z.uuid().parse(source.appId),
        workflowId: source.selection.workflowId,
      }
    : undefined;
  if (source) {
    await accessTransaction(db, actor.uid, async () => {}, actor.auth_time);
    const version = await selectedWorkflowVersion(
      source.appId,
      source.selection,
      request,
    );
    const exported = z
      .object({ data: z.string().max(1024 * 1024) })
      .parse(
        await request(
          `/apps/${source.appId}/export?include_secret=false&workflow_id=${version.id}`,
          { management: true },
        ),
      );
    const document = parseDocument(exported.data, { customTags: [] });
    if (document.errors.length)
      throw new AppError(
        "DIFY_COPY_INVALID",
        "The selected workflow could not be exported safely.",
        409,
      );
    const dsl = document.toJS({ maxAliasCount: 0 }) as ReturnType<
      typeof orchestratorTemplate
    >["dsl"];
    if (
      fingerprint(z.json().parse(dsl.workflow.graph)) !==
      fingerprint(z.json().parse(version.graph))
    )
      throw new AppError(
        "DIFY_COPY_CHANGED",
        "Dify exported a different version. Reload versions before copying.",
        409,
      );
    const fit = inspectDifyWorkflow(dsl.workflow.graph, "raw-v1");
    let setupRequired = false;
    for (const variable of dsl.workflow.environment_variables ?? []) {
      if (variable.value_type === "secret") {
        variable.value = "";
        setupRequired = true;
      }
    }
    template = {
      id: templateId,
      title: dsl.app.name,
      description: dsl.app.description,
      dsl,
      requiredTools: fit.mcpTools
        .filter((t) => tools.some((own) => own.name === t.toolName))
        .map((t) => t.toolName),
      setupRequired,
      build: () => structuredClone(dsl),
    };
  } else template = orchestratorTemplate(templateId);
  const destinationName = `${template.dsl.app.name.replace(/\s*\[(local|staging|production)\]$/, "").slice(0, 80)} [${identity.environment}]`;
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
    identity.project,
    identity.environment,
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
      if (state && (state.templateId ?? "document-summary") !== templateId)
        throw new AppError(
          "DIFY_CREATION_TEMPLATE_CHANGED",
          "This creation attempt belongs to another template. Retry its original template.",
          409,
        );
      if (
        state &&
        fingerprint(state.source ?? null) !== fingerprint(provenance ?? null)
      )
        throw new AppError(
          "DIFY_COPY_SOURCE_CHANGED",
          "This operation belongs to another source version. Resume its original copy.",
          409,
        );
      if (state && state.until > new Date())
        throw new AppError(
          "DIFY_CREATION_BUSY",
          "Creation is still running. Retry shortly to check it.",
          409,
        );
      if (state?.started && !state.appId)
        throw new AppError(
          "DIFY_CREATION_UNKNOWN",
          `Dify did not confirm the new app. Refresh apps and check for ${template.dsl.app.name} before creating another.`,
          409,
        );
      await records.updateOne(
        { _id: id },
        {
          $set: {
            owner,
            templateId,
            source: provenance,
            until: new Date(Date.now() + 240000),
          },
        },
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
    const binding = await ensureEnvironmentMcp(
      template.requiredTools,
      db,
      creationRequest,
      env,
      () => checkpoint({}),
    );
    if (!appId) {
      const dsl = template.build(binding.providerId);
      dsl.app.name = destinationName;
      dsl.workflow.graph = (await bindEnvironmentGraph(
        dsl.workflow.graph,
        binding,
        db,
        true,
      )) as typeof dsl.workflow.graph;
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
      await recordAppOwnership(appId, id, binding, db, env, provenance);
      await db.collection<Document>("auditEvents").insertOne({
        event: "orchestrator-creation",
        actorUid: actor.uid,
        appId,
        reason: `Create ${template.title} workflow`,
        templateId,
        timestamp: new Date(),
      });
    }
    // A retry must verify its saved app before attempting any setting mutation.
    await creationRequest(`/apps/${appId}`, { management: true });
    // Resume ownership/tagging only for the app returned by this journaled import.
    await checkpoint({ appId });
    await recordAppOwnership(appId, id, binding, db, env, provenance);
    if (!prior?.tagged) {
      await tagOwnedApp(appId, binding, creationRequest, () => checkpoint({}));
      await checkpoint({ tagged: true });
    }
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
      // Knowledge bases and multimodal models belong to the destination Dify
      // workspace. Never publish/register an unconfigured sample or overwrite
      // its draft when a caller retries the same import intent.
      if (template.setupRequired)
        return {
          status: "setup-required" as const,
          appId,
          name: destinationName,
        };
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
        await verifyDestinationResources(draft, creationRequest);
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
    if (
      appId &&
      error instanceof AppError &&
      error.code === "DIFY_RESOURCE_REQUIRED"
    )
      return {
        status: "setup-required" as const,
        appId,
        name: destinationName,
      };
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
