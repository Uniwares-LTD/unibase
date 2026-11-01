import { PageMessages } from "@/components/page-messages";

import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { OrchestratorEditor } from "@/components/runs/orchestrator-editor";
import { discoverDifyOrchestrators } from "@/lib/server/runs/registration";
import { AppError } from "@/lib/auth-policy";
import { PageHeader } from "@/components/page-patterns";
import { orchestratorTemplates } from "@/lib/server/runs/templates";
import { getConfig } from "@/lib/server/config";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Orchestrators" };
}
export default async function Page() {
  await adminPageSession();
  let catalog: Awaited<ReturnType<typeof discoverDifyOrchestrators>> = {
    apps: [],
    currentEnvironment: getConfig().server.environment,
  };
  let error: string | undefined;
  try {
    catalog = await discoverDifyOrchestrators();
    error = catalog.warning;
  } catch (cause) {
    error =
      cause instanceof AppError
        ? cause.message
        : "Dify apps could not be loaded. Check the Console connection and refresh.";
  }
  return (
    <PageMessages path="/admin/orchestrators">
      <div className="page-stack">
        <PageHeader
          title="Orchestrators"
          description="Create from a template or register a Dify workflow."
        />
        <OrchestratorEditor
          initial={catalog}
          initialError={error}
          templates={orchestratorTemplates()}
        />
      </div>
    </PageMessages>
  );
}
