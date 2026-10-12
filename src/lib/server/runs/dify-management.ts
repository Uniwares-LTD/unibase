import "server-only";
import { z } from "zod";
import { requireAdmin } from "../admin";
import { createDifyOrchestrator } from "./creation";
import { changeOrchestrator } from "./orchestrator-lifecycle";
import {
  discoverDifyOrchestrators,
  registerDifyOrchestrator,
  registrationStatus,
} from "./registration";

// Registration replaces the removed manual definitions and graph/DSL setup tools.
// Registration is one server-owned operation; callers never submit a definition.
export const managementCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("discover") }),
  z.strictObject({ action: z.literal("create"), key: z.string().uuid() }),
  z.strictObject({ action: z.literal("register"), appId: z.string().uuid() }),
  z.strictObject({ action: z.literal("status"), appId: z.string().uuid() }),
  z.strictObject({
    action: z.literal("disable"),
    orchestratorId: z.string().min(1).max(100),
  }),
  z.strictObject({
    action: z.literal("unregister"),
    orchestratorId: z.string().min(1).max(100),
  }),
]);
export async function manageDify(input: unknown) {
  const command = managementCommandSchema.parse(input);
  const actor = await requireAdmin(
    !["discover", "status"].includes(command.action),
  );
  if (command.action === "disable" || command.action === "unregister")
    return changeOrchestrator(command.action, command.orchestratorId, actor);
  if (command.action === "create")
    return createDifyOrchestrator(command.key, actor);
  if (command.action === "discover") return discoverDifyOrchestrators();
  if (command.action === "status") return registrationStatus(command.appId);
  return registerDifyOrchestrator(command.appId, actor);
}
