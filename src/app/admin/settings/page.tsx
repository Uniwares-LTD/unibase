import { PageMessages } from "@/components/page-messages";

import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { BaseSettingsEditor } from "@/components/runs/admin-editors";
import { settingsView } from "@/lib/server/settings";
import { PageHeader } from "@/components/page-patterns";
import { DiagnosticAccess } from "@/components/diagnostic-access";
import { diagnosticsAvailability } from "@/lib/server/diagnostics/availability";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Base settings" };
}
export default async function Page() {
  await adminPageSession();
  return (
    <PageMessages path="/admin/settings">
      <div className="page-stack">
        <PageHeader
          title="Base settings"
          description="Application defaults, credits, and run policies."
        />
        <BaseSettingsEditor initial={await settingsView()} />
        <DiagnosticAccess availability={diagnosticsAvailability()} />
      </div>
    </PageMessages>
  );
}
