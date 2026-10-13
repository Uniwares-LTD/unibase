import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { OrchestratorEditor } from "@/components/runs/orchestrator-editor";
import { discoverDifyOrchestrators } from "@/lib/server/runs/registration";
import { AppError } from "@/lib/auth-policy";
import { requireAdmin } from "@/lib/server/admin";
import { PageHeader } from "@/components/page-patterns";
import { orchestratorTemplates } from "@/lib/server/runs/templates";
export default async function Page() {
  const translate = await getTranslations("ui");

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
      cause instanceof AppError ? cause.message : translate("md495ec6cf125");
  }
  return (
    <PageMessages path="/admin/orchestrators">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m9375b0d5e9f0")}
            description={translate("m67c91f3a3462")}
          />
          <OrchestratorEditor
            initial={catalog}
            initialError={error}
            templates={orchestratorTemplates()}
          />
        </div>
      }
    </PageMessages>
  );
}
