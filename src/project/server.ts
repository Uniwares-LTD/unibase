import "server-only";
import type { ServerExtension } from "../lib/server/extensions";
import { notesServerExtension } from "../samples/notes/server"; // sample:notes

// Project-owned server registry: MCP tools, domain adapters, indexes and
// migrations for the entries in ./extensions.ts. Imported only by server code.
export const serverExtensions: readonly ServerExtension[] = [
  notesServerExtension, // sample:notes
];
