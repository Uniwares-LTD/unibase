import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { BaseSettingsEditor } from "@/components/runs/admin-editors";
import { settingsView } from "@/lib/server/settings";
import { PageHeader } from "@/components/page-patterns";
import { DiagnosticAccess } from "@/components/diagnostic-access";
import { diagnosticsAvailability } from "@/lib/server/diagnostics/availability";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m667f51f3c86a") };
}
export default async function Page() {
  const translate = await getTranslations("ui");

  await adminPageSession();
  return (
    <PageMessages path="/admin/settings">
      <div className="page-stack">
        <PageHeader
          title={translate("m667f51f3c86a")}
          description={translate("m2938db2aa6de")}
        />
        <BaseSettingsEditor initial={await settingsView()} />
        <DiagnosticAccess availability={diagnosticsAvailability()} />
      </div>
    </PageMessages>
  );
}
