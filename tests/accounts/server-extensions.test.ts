import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  extensionTools,
  validateServerExtensions,
  type ServerExtension,
} from "../../src/lib/server/extensions";
import type { RegisteredTool } from "../../src/lib/server/mcp/tools";
import type { ModuleId } from "../../src/lib/project";

const tool: RegisteredTool = {
  name: "list_notes_v1",
  description: "List notes.",
  permission: "notes:read",
  input: z.strictObject({}),
  output: z.strictObject({}),
  async run() {
    return {};
  },
};
const notes: ServerExtension = {
  module: "notes" as ModuleId,
  mcpTools: [tool],
};

test("extension MCP tools join the catalog only for enabled modules", () => {
  assert.deepEqual(
    extensionTools([notes], () => true),
    [tool],
  );
  assert.deepEqual(
    extensionTools([notes], () => false),
    [],
  );
});

test("server extensions must name a known module and unique tools", () => {
  assert.doesNotThrow(() =>
    validateServerExtensions(["get_server_info_v1"], [notes], ["notes"]),
  );
  assert.throws(() => validateServerExtensions([], [notes], ["files"]));
  assert.throws(() =>
    validateServerExtensions(["list_notes_v1"], [notes], ["notes"]),
  );
  assert.throws(() => validateServerExtensions([], [notes, notes], ["notes"]));
  assert.throws(
    () =>
      validateServerExtensions(
        [],
        [
          {
            ...notes,
            mcpTools: [],
            migrations: [
              { id: "core:0001-x", description: "x", run: async () => {} },
            ],
          },
        ],
        ["notes"],
      ),
    /must belong to module notes/,
  );
});
