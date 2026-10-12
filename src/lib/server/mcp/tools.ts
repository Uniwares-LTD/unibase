import "server-only";
import { z } from "zod";
import { demoScenarioTools } from "./demo-scenarios";
import { privateTools } from "./private-tools";

export const catalogVersion = "1.2.0";
export type ToolContext = {
  clientId: string;
  appName: string;
  requestId: string;
  signal: AbortSignal;
};
export type RegisteredTool = {
  name: string;
  description: string;
  permission: string;
  write?: boolean;
  input: z.ZodObject;
  output: z.ZodObject;
  run: (
    input: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<Record<string, unknown>>;
};

// Only synthetic, intentionally shareable content belongs in these examples.
const reference = {
  id: "unibase-demo",
  revision: "1",
  title: "Demo observatory visitor guide",
  body: "The fictional Cedar Observatory opens at 19:30 on Fridays. Its visitor password is silver-lantern. Admission includes a telescope demonstration. This is synthetic test data, not a real venue.",
};

export const tools: readonly RegisteredTool[] = [
  {
    name: "get_server_info_v1",
    description:
      "Read the public application name and MCP tool catalog version.",
    permission: "server:read",
    input: z.strictObject({}),
    output: z.strictObject({ appName: z.string(), catalogVersion: z.string() }),
    async run(_input, context) {
      return { appName: context.appName, catalogVersion };
    },
  },
  {
    name: "get_reference_document_v1",
    description:
      "Read an allowlisted synthetic reference document for integration testing. Contains no user data.",
    permission: "reference:read",
    input: z.strictObject({ documentId: z.literal("unibase-demo") }),
    output: z.strictObject({
      id: z.string(),
      revision: z.string(),
      title: z.string(),
      body: z.string(),
      requestId: z.string().uuid(),
    }),
    async run(_input, context) {
      context.signal.throwIfAborted();
      return { ...reference, requestId: context.requestId };
    },
  },
  ...demoScenarioTools,
  ...privateTools,
];
