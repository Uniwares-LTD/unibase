import "server-only";
import { requireAdmin } from "../admin";
import { createDifyOrchestrator } from "./creation";
import { changeOrchestrator } from "./orchestrator-lifecycle";
import { managementCommandSchema } from "@/lib/contracts/orchestrator-management";
import { difyWorkflowVersions } from "./workflow-versions";
import {
  discoverDifyOrchestrators,
  registerDifyOrchestrator,
  registrationStatus,
} from "./registration";

// Registration replaces the removed manual definitions and graph/DSL setup tools.
// Registration is one server-owned operation; callers never submit a definition.
export { managementCommandSchema } from "@/lib/contracts/orchestrator-management";

export async function manageDify(input: unknown) {
  const command = managementCommandSchema.parse(input);
  const actor = await requireAdmin();
  if (command.action === "disable" || command.action === "unregister")
    return changeOrchestrator(command.action, command.orchestratorId, actor);
  if (command.action === "create")
    return createDifyOrchestrator(
      command.key,
      actor,
      undefined,
      undefined,
      undefined,
      command.templateId,
    );
  if (command.action === "discover") return discoverDifyOrchestrators();
  if (command.action === "status") return registrationStatus(command.appId);
  if (command.action === "versions")
    return difyWorkflowVersions(command.appId, command.page);
  return registerDifyOrchestrator(
    command.appId,
    actor,
    undefined,
    undefined,
    undefined,
    command.selection,
  );
}
