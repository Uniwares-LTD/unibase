import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { BaseSettingsEditor } from "@/components/runs/admin-editors";
import { settingsView } from "@/lib/server/settings";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  const translate = await getTranslations("ui");

  return (
    <PageMessages path="/admin/settings">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m667f51f3c86a")}
            description={translate("m2938db2aa6de")}
          />
          <BaseSettingsEditor initial={await settingsView()} />
        </div>
      }
    </PageMessages>
  );
}
