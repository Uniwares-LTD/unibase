import { BaseSettingsEditor } from "@/components/runs/admin-editors";
import { settingsView } from "@/lib/server/settings";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Base settings"
        description="Application defaults, credits, and run policies."
      />
      <BaseSettingsEditor initial={await settingsView()} />
    </div>
  );
}
