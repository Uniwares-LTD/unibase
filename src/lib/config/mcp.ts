import { z } from "zod";

export const mcpPermissions = [
  "server:read",
  "reference:read",
  "demo:read",
  "run:read",
  "artifact:read",
  "artifact:write",
] as const;
const clientsSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      tokenEnv: z.string().regex(/^MCP_TOKEN_[A-Z0-9_]+$/),
      permissions: z.array(z.enum(mcpPermissions)).min(1),
    }),
  )
  .min(1)
  .max(32);

export type McpConfig =
  | { enabled: false }
  | {
      enabled: true;
      hosts: string[];
      origins: string[];
      clients: { id: string; token: string; permissions: string[] }[];
    };

export function parseMcpConfig(
  env: Record<string, string | undefined>,
  origin: string,
): McpConfig {
  if (env.MCP_ENABLED === undefined || env.MCP_ENABLED === "false")
    return { enabled: false };
  try {
    if (env.MCP_ENABLED !== "true") throw new Error();
    const extra = z
      .array(z.string())
      .max(16)
      .parse(JSON.parse(env.MCP_ALLOWED_HOSTS_JSON ?? "[]"));
    const hosts = [new URL(origin).host, ...extra];
    for (const host of hosts) {
      if (
        !/^[a-zA-Z0-9.\-\[\]:]+$/.test(host) ||
        new URL(`https://${host}`).host !== host.toLowerCase()
      )
        throw new Error();
    }
    const clients = clientsSchema
      .parse(JSON.parse(env.MCP_CLIENTS_JSON ?? ""))
      .map((client) => {
        const token = env[client.tokenEnv];
        if (!token || !/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw new Error();
        return { id: client.id, token, permissions: client.permissions };
      });
    if (
      new Set(clients.map((c) => c.id)).size !== clients.length ||
      new Set(clients.map((c) => c.token)).size !== clients.length
    )
      throw new Error();
    return {
      enabled: true,
      hosts: hosts.map((h) => h.toLowerCase()),
      origins: [
        ...new Set([origin, ...extra.map((h) => `https://${h.toLowerCase()}`)]),
      ],
      clients,
    };
  } catch {
    throw new Error(
      "Invalid MCP configuration: check MCP_ENABLED, MCP_CLIENTS_JSON, MCP_ALLOWED_HOSTS_JSON and referenced MCP_TOKEN_* variables.",
    );
  }
}
