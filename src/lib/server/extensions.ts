import "server-only";
import type { Db } from "mongodb";
import type { ModuleId } from "../project";
import type { DomainAdapter } from "./domains";
import type { RegisteredTool } from "./mcp/tools";

// Server-only half of the extension contract; see src/lib/extensions.ts.
// Entries run with the same permission, module and ownership checks as core.
export type ServerExtension = {
  // Contributions are disabled when this module is not enabled.
  module: ModuleId;
  mcpTools?: readonly RegisteredTool[];
  domainAdapters?: readonly DomainAdapter[];
  // Idempotent index setup run by db:indexes.
  indexes?: (db: Db) => Promise<void>;
};

export function defineServerExtension(extension: ServerExtension) {
  return extension;
}

export function validateServerExtensions(
  coreToolNames: readonly string[],
  extensions: readonly ServerExtension[],
  moduleIds: readonly string[],
) {
  const names = new Set(coreToolNames);
  for (const extension of extensions) {
    if (!moduleIds.includes(extension.module))
      throw new Error(
        `Server extension module ${extension.module} is unknown.`,
      );
    for (const tool of extension.mcpTools ?? []) {
      if (names.has(tool.name))
        throw new Error(`Duplicate MCP tool ${tool.name}.`);
      names.add(tool.name);
    }
  }
}

export function extensionTools(
  extensions: readonly ServerExtension[],
  enabled: (id: ModuleId) => boolean,
) {
  return extensions
    .filter((extension) => enabled(extension.module))
    .flatMap((extension) => extension.mcpTools ?? []);
}
