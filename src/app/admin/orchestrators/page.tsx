import { OrchestratorEditor } from "@/components/runs/orchestrator-editor";
import { discoverDifyOrchestrators } from "@/lib/server/runs/registration";
import { AppError } from "@/lib/auth-policy";
import { requireAdmin } from "@/lib/server/admin";
import { PageHeader } from "@/components/page-patterns";
import { orchestratorTemplates } from "@/lib/server/runs/templates";
export default async function Page() {
  await requireAdmin();
  let catalog: Awaited<ReturnType<typeof discoverDifyOrchestrators>> = {
    apps: [],
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
  );
}
