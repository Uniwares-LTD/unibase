import "server-only";
import type { ServerExtension } from "../lib/server/extensions";

// Project-owned server registry: MCP tools, domain adapters and indexes for the
// entries in ./extensions.ts. Imported only by server code.
export const serverExtensions: readonly ServerExtension[] = [];
