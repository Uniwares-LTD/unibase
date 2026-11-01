import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { OrchestratorEditor } from "@/components/runs/orchestrator-editor";
import { discoverDifyOrchestrators } from "@/lib/server/runs/registration";
import { AppError } from "@/lib/auth-policy";
import { PageHeader } from "@/components/page-patterns";
import { orchestratorTemplates } from "@/lib/server/runs/templates";
import { getConfig } from "@/lib/server/config";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m9375b0d5e9f0") };
}
export default async function Page() {
  const translate = await getTranslations("ui");

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
      cause instanceof AppError ? cause.message : translate("md495ec6cf125");
  }
  return (
    <PageMessages path="/admin/orchestrators">
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
    </PageMessages>
  );
}
