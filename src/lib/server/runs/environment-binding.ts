import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import { project } from "@/lib/project";
import { parseMcpConfig } from "@/lib/config/mcp";
import {
  deploymentEnvironmentSchema,
  workflowBindingSchema,
  type WorkflowBinding,
} from "@/lib/contracts/environment-binding";
import { fingerprint } from "../ai/jobs";
import { tools } from "../mcp/tools";
import { baseSettingsSchema } from "@/lib/contracts/settings";
import { difyJson } from "./dify-console-client";

type Env = Record<string, string | undefined>;
export type AppOwnership = {
  _id: string;
  binding: WorkflowBinding;
  operationId: string;
  source?: { appId: string; workflowId: string };
  createdAt: Date;
};
const fail = (code: string, message: string) =>
  new AppError(code, message, 409);
export function environmentIdentity(env: Env = process.env) {
  const environment = deploymentEnvironmentSchema.parse(env.APP_ENV ?? "local");
  const workspaceId = z.uuid().parse(env.DIFY_WORKSPACE_ID);
  const instance = z.url().parse(env.DIFY_CONSOLE_URL).replace(/\/$/, "");
  return { project: project.slug, environment, workspaceId, instance };
}
export function environmentMcpConfiguration(env: Env = process.env) {
  const identity = environmentIdentity(env);
  const origin = env.APP_ORIGIN ?? "http://localhost:3000";
  if (identity.environment === "local" && !env.MCP_PUBLIC_URL)
    throw fail(
      "DIFY_MCP_TUNNEL_REQUIRED",
      "Configure MCP_PUBLIC_URL with this local server’s reachable HTTPS tunnel /api/mcp endpoint.",
    );
  if (identity.environment !== "local" && env.MCP_PUBLIC_URL)
    throw fail(
      "DIFY_MCP_ENDPOINT_INVALID",
      "Hosted environments cannot use MCP_PUBLIC_URL.",
    );
  const endpoint = new URL(
    identity.environment === "local" ? env.MCP_PUBLIC_URL! : "/api/mcp",
    origin,
  );
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/api/mcp"
  )
    throw fail(
      "DIFY_MCP_ENDPOINT_INVALID",
      "The MCP endpoint must use HTTPS and /api/mcp without credentials, query or fragment.",
    );
  const config = parseMcpConfig(env, origin);
  const client = config.enabled
    ? config.clients.find((c) => c.id === (env.RUN_MCP_CLIENT_ID ?? "dify"))
    : undefined;
  if (!client)
    throw fail(
      "DIFY_MCP_CLIENT_REQUIRED",
      "Enable and configure this environment’s Run MCP client.",
    );
  if (!client.permissions.includes("server:read"))
    throw fail(
      "DIFY_MCP_PERMISSIONS",
      "The Run MCP client needs server:read for identity verification.",
    );
  const providerId = `${project.slug.replaceAll("-", "_")}_managed_${identity.environment}`;
  return {
    binding: workflowBindingSchema.parse({
      ...identity,
      endpoint: endpoint.href,
      providerId,
    }),
    client,
    origin,
  };
}

/** Bounded, authenticated, read-only probe. Never follows a credential-bearing redirect. */
export async function probeEnvironmentMcp(
  env: Env,
  requiredTools: string[],
  fetcher: typeof fetch = fetch,
) {
  const { binding, client, origin } = environmentMcpConfiguration(env);
  const invoke = async (method: string, params: unknown) => {
    let response: Response;
    try {
      response = await fetcher(binding.endpoint, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${client.token}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-03-26",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method,
          params,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw fail(
        "DIFY_MCP_UNREACHABLE",
        "This environment’s MCP endpoint could not be reached. Check the tunnel or ingress.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw fail(
        response.status === 401 || response.status === 403
          ? "DIFY_MCP_AUTHENTICATION"
          : "DIFY_MCP_UNREACHABLE",
        "This environment’s MCP endpoint rejected verification. Check its credential, permissions and availability.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader)
      throw fail("DIFY_MCP_IDENTITY", "MCP returned no identity response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) {
        await reader.cancel();
        throw fail(
          "DIFY_MCP_IDENTITY",
          "MCP verification response exceeds its limit.",
        );
      }
      chunks.push(value);
    }
    try {
      return z
        .object({ result: z.unknown() })
        .parse(JSON.parse(Buffer.concat(chunks).toString())).result;
    } catch {
      throw fail(
        "DIFY_MCP_IDENTITY",
        "MCP returned an invalid verification response.",
      );
    }
  };
  const identity = z
    .object({
      structuredContent: z.object({
        project: z.string(),
        environment: deploymentEnvironmentSchema,
        origin: z.string(),
      }),
      isError: z.boolean().optional(),
    })
    .parse(
      await invoke("tools/call", {
        name: "get_connection_info_v1",
        arguments: {},
      }),
    );
  if (
    identity.isError ||
    identity.structuredContent.project !== binding.project ||
    identity.structuredContent.environment !== binding.environment ||
    identity.structuredContent.origin !== origin
  )
    throw fail(
      "DIFY_MCP_IDENTITY",
      "The MCP endpoint belongs to another project, environment or application origin.",
    );
  const catalog = z
    .object({ tools: z.array(z.object({ name: z.string() })).max(1000) })
    .parse(await invoke("tools/list", {}));
  for (const name of requiredTools) {
    const tool = tools.find((t) => t.name === name);
    if (
      !tool ||
      !client.permissions.includes(tool.permission) ||
      !catalog.tools.some((t) => t.name === name)
    )
      throw fail(
        "DIFY_MCP_PERMISSIONS",
        `This environment’s MCP client does not expose required tool ${name}.`,
      );
  }
  return binding;
}

const providerSchema = z.object({
  id: z.uuid(),
  server_identifier: z.string(),
  name: z.string(),
  server_url: z.string().optional(),
});
type ProviderSetup = {
  _id: string;
  owner: string;
  until: Date;
  started?: boolean;
  providerUuid?: string;
};
export async function ensureEnvironmentMcp(
  requiredTools: string[],
  db: Db,
  request: typeof difyJson,
  env: Env,
  guard: () => Promise<unknown>,
  probe = probeEnvironmentMcp,
) {
  const binding = await probe(env, requiredTools);
  const { client } = environmentMcpConfiguration(env);
  const id = fingerprint([
    binding.instance,
    binding.workspaceId,
    binding.providerId,
  ]);
  const records = db.collection<ProviderSetup>("environmentMcpSetups");
  const owner = randomUUID();
  let prior: ProviderSetup | null;
  try {
    prior = await records.findOneAndUpdate(
      {
        _id: id,
        $or: [{ until: { $lte: new Date() } }, { until: { $exists: false } }],
      },
      { $set: { owner, until: new Date(Date.now() + 120000) } },
      { upsert: true, returnDocument: "before" },
    );
  } catch {
    throw fail(
      "DIFY_MCP_BUSY",
      "MCP setup is already running. Retry after it completes.",
    );
  }
  const checkpoint = async (fields: Partial<ProviderSetup>) => {
    await guard();
    const result = await records.updateOne(
      { _id: id, owner, until: { $gt: new Date() } },
      { $set: fields },
    );
    if (!result.matchedCount)
      throw fail(
        "DIFY_MCP_BUSY",
        "MCP setup changed. Refresh before continuing.",
      );
  };
  try {
    const catalog = z
      .array(providerSchema)
      .max(1000)
      .parse(
        await request("/workspaces/current/tool-providers?type=mcp", {
          management: true,
        }),
      );
    let provider = catalog.find(
      (p) => p.server_identifier === binding.providerId,
    );
    const expectedName = `${project.displayName.slice(0, 24)} [${binding.environment}] MCP`;
    if (
      provider &&
      (prior?.providerUuid
        ? provider.id !== prior.providerUuid
        : !prior?.started || provider.name !== expectedName)
    )
      throw fail(
        "DIFY_MCP_COLLISION",
        "This environment’s MCP identifier already exists outside managed setup. Rename that connection in Dify before retrying.",
      );
    const body = {
      // Dify also enforces URL uniqueness. Namespace the managed connection
      // without modifying another provider or changing the canonical probe URL.
      // This public discriminator carries no credential and grants no access.
      server_url: (() => {
        const url = new URL(binding.endpoint);
        url.searchParams.set("connection", binding.providerId);
        return url.href;
      })(),
      name: expectedName,
      icon: "🔌",
      icon_type: "emoji",
      icon_background: "#EFF1F5",
      server_identifier: binding.providerId,
      headers: { Authorization: `Bearer ${client.token}` },
      identity_mode: "off",
    };
    if (!provider) {
      await checkpoint({ started: true });
      await request("/workspaces/current/tool-provider/mcp", {
        management: true,
        body,
      });
      const updated = z.array(providerSchema).parse(
        await request("/workspaces/current/tool-providers?type=mcp", {
          management: true,
        }),
      );
      provider = updated.find(
        (p) => p.server_identifier === binding.providerId,
      );
      if (!provider)
        throw fail(
          "DIFY_MCP_OUTCOME_UNKNOWN",
          "Dify did not confirm MCP creation. Retry setup to inspect the saved operation.",
        );
      await checkpoint({ providerUuid: provider.id });
    }
    // Never retain headers from a foreign connection. Only this server's selected credential is installed.
    await checkpoint({ providerUuid: provider.id });
    await request("/workspaces/current/tool-provider/mcp", {
      management: true,
      method: "PUT",
      body: { ...body, provider_id: provider.id },
    });
    const refreshed = z
      .object({
        server_identifier: z.string(),
        is_team_authorization: z.boolean(),
        tools: z.array(z.object({ name: z.string() })),
      })
      .parse(
        await request(
          `/workspaces/current/tool-provider/mcp/update/${provider.id}`,
          { management: true },
        ),
      );
    if (
      refreshed.server_identifier !== binding.providerId ||
      !refreshed.is_team_authorization ||
      requiredTools.some(
        (name) => !refreshed.tools.some((t) => t.name === name),
      )
    )
      throw fail(
        "DIFY_MCP_PERMISSIONS",
        `Dify could not discover the required tools from this environment’s MCP connection: ${requiredTools.join(", ")}.`,
      );
    return binding;
  } finally {
    await records.updateOne(
      { _id: id, owner },
      { $set: { until: new Date(0) } },
    );
  }
}

export function ownershipId(appId: string, env: Env) {
  const identity = environmentIdentity(env);
  return fingerprint([identity.instance, identity.workspaceId, appId]);
}
export async function recordAppOwnership(
  appId: string,
  operationId: string,
  binding: WorkflowBinding,
  db: Db,
  env: Env,
  source?: AppOwnership["source"],
) {
  await db
    .collection<AppOwnership>("difyAppOwnership")
    .updateOne(
      { _id: ownershipId(appId, env) },
      { $setOnInsert: { binding, operationId, source, createdAt: new Date() } },
      { upsert: true },
    );
}
export async function verifyAppOwnership(
  appId: string,
  db: Db,
  request: typeof difyJson,
  env: Env,
) {
  const owned = await db
    .collection<AppOwnership>("difyAppOwnership")
    .findOne({ _id: ownershipId(appId, env) });
  const identity = environmentIdentity(env);
  if (
    !owned ||
    Object.entries(identity).some(
      ([key, value]) => owned.binding[key as keyof WorkflowBinding] !== value,
    )
  )
    throw fail(
      "DIFY_ENVIRONMENT_OWNERSHIP",
      "This app is unmanaged or belongs to another environment. Create a copy for this environment.",
    );
  const imported = await db
    .collection<Document & { _id: string }>("orchestratorCreations")
    .findOne({ _id: owned.operationId, appId, started: true });
  if (
    !imported ||
    fingerprint(imported.source ?? null) !== fingerprint(owned.source ?? null)
  )
    throw fail(
      "DIFY_ENVIRONMENT_OWNERSHIP",
      "This app has no matching confirmed import operation. Create a copy for this environment.",
    );
  const app = z
    .object({
      name: z.string(),
      tags: z.array(z.object({ name: z.string() })).default([]),
    })
    .parse(await request(`/apps/${appId}`, { management: true }));
  const required = `app:${identity.project}-${identity.environment}`;
  const identityTags = app.tags.filter((t) => t.name.startsWith("app:"));
  if (
    !app.name.endsWith(`[${identity.environment}]`) ||
    identityTags.length !== 1 ||
    identityTags[0].name !== required
  )
    throw fail(
      "DIFY_ENVIRONMENT_OWNERSHIP",
      "Dify environment metadata is missing or conflicting. Restore the app’s recorded environment name and tag.",
    );
  return owned;
}
export async function tagOwnedApp(
  appId: string,
  binding: WorkflowBinding,
  request: typeof difyJson,
  guard: () => Promise<unknown>,
) {
  const name = `app:${binding.project}-${binding.environment}`;
  const schema = z.object({ id: z.uuid(), name: z.string() });
  const tags = z
    .array(schema)
    .parse(await request("/tags?type=app", { management: true }));
  let tag = tags.find((t) => t.name === name);
  if (!tag) {
    await guard();
    tag = schema.parse(
      await request("/tags", { management: true, body: { name, type: "app" } }),
    );
  }
  await guard();
  await request("/tag-bindings", {
    management: true,
    body: { tag_ids: [tag.id], target_id: appId, type: "app" },
  });
}
export async function bindEnvironmentGraph(
  graph: unknown,
  binding: WorkflowBinding,
  db: Db,
  rewrite: boolean,
) {
  const copy = z
    .object({
      nodes: z.array(
        z
          .object({ id: z.string(), data: z.record(z.string(), z.unknown()) })
          .passthrough(),
      ),
    })
    .passthrough()
    .parse(structuredClone(graph));
  const stored = await db
    .collection<Document & { _id: string }>("baseSettings")
    .findOne({ _id: "base" });
  const mappings = stored
    ? baseSettingsSchema.parse(stored.settings).runs.externalMcpMappings
    : [];
  for (const node of copy.nodes) {
    if (node.data.type !== "tool" || node.data.provider_type !== "mcp")
      continue;
    const own = tools.some((t) => t.name === node.data.tool_name);
    const provider = String(node.data.provider_id ?? "");
    const mapping = mappings.find((m) =>
      rewrite ? m.source === provider : m.destination === provider,
    );
    const destination = own ? binding.providerId : mapping?.destination;
    if (!destination)
      throw fail(
        "DIFY_MCP_MAPPING_REQUIRED",
        `Configure an external MCP mapping for node ${node.id} before registration.`,
      );
    if (!rewrite && provider !== destination)
      throw fail(
        "DIFY_MCP_BINDING_MISMATCH",
        `Node ${node.id} uses another MCP connection. Bind and publish this environment’s draft, then select the new version.`,
      );
    if (rewrite && provider !== destination) {
      node.data.provider_id = destination;
      node.data.provider_name = destination;
    }
  }
  return copy;
}
export function assertRunEnvironment(
  binding: WorkflowBinding | undefined,
  env: Env = process.env,
) {
  if (env.DIFY_MODE === "fake") return;
  if (!binding)
    throw fail(
      "DIFY_ENVIRONMENT_OWNERSHIP",
      "This orchestrator needs an environment-owned registration.",
    );
  const identity = environmentIdentity(env);
  if (
    !binding ||
    Object.entries(identity).some(
      ([key, value]) => binding[key as keyof WorkflowBinding] !== value,
    )
  )
    throw fail(
      "DIFY_ENVIRONMENT_OWNERSHIP",
      "This orchestrator is not registered for the current environment.",
    );
}

/** Check discoverable prerequisites without invoking a model, tool or workflow. */
export async function verifyDestinationResources(
  workflow: { graph?: unknown; environment_variables?: unknown },
  request: typeof difyJson,
) {
  const variables = z
    .array(
      z.object({
        value_type: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .parse(workflow.environment_variables ?? []);
  if (
    variables.some(
      (v) =>
        v.value_type === "secret" &&
        (v.value === undefined || v.value === null || v.value === ""),
    )
  )
    throw fail(
      "DIFY_RESOURCE_REQUIRED",
      "Configure destination secret variables in Dify, then register this app.",
    );
  const { nodes } = z
    .object({
      nodes: z.array(
        z.object({ id: z.string(), data: z.record(z.string(), z.unknown()) }),
      ),
    })
    .parse(workflow.graph);
  const llms = nodes.filter((n) => n.data.type === "llm");
  if (llms.length) {
    const models = z
      .object({
        data: z.array(
          z.object({
            provider: z.string(),
            status: z.string(),
            models: z.array(
              z.object({ model: z.string(), status: z.string().optional() }),
            ),
          }),
        ),
      })
      .parse(
        await request("/workspaces/current/models/model-types/llm", {
          management: true,
        }),
      );
    for (const node of llms) {
      const model = z
        .object({
          provider: z.string().optional(),
          name: z.string().optional(),
        })
        .parse(node.data.model ?? {});
      if (
        !models.data.some(
          (p) =>
            p.provider === model.provider &&
            p.status === "active" &&
            p.models.some(
              (m) =>
                m.model === model.name && (!m.status || m.status === "active"),
            ),
        )
      )
        throw fail(
          "DIFY_RESOURCE_REQUIRED",
          `Configure the destination model for node ${node.id} in Dify, then register this app.`,
        );
    }
  }
  const datasets = new Set<string>();
  for (const node of nodes.filter(
    (n) => n.data.type === "knowledge-retrieval",
  )) {
    const ids = z.array(z.uuid()).min(1).safeParse(node.data.dataset_ids);
    if (!ids.success)
      throw fail(
        "DIFY_RESOURCE_REQUIRED",
        `Choose a destination knowledge base for node ${node.id} in Dify.`,
      );
    ids.data.forEach((id) => datasets.add(id));
  }
  for (const id of datasets) {
    try {
      await request(`/datasets/${id}`, { management: true });
    } catch {
      throw fail(
        "DIFY_RESOURCE_REQUIRED",
        "A destination knowledge base is unavailable. Configure it in Dify before registration.",
      );
    }
  }
  const builtin = nodes.filter(
    (n) => n.data.type === "tool" && n.data.provider_type === "builtin",
  );
  if (builtin.length) {
    const providers = z
      .array(z.object({ id: z.string(), is_team_authorization: z.boolean() }))
      .parse(
        await request("/workspaces/current/tool-providers?type=builtin", {
          management: true,
        }),
      );
    for (const node of builtin)
      if (
        !providers.some(
          (p) => p.id === node.data.provider_id && p.is_team_authorization,
        )
      )
        throw fail(
          "DIFY_RESOURCE_REQUIRED",
          `Configure the destination tool provider for node ${node.id} in Dify.`,
        );
  }
}
