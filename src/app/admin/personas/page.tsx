import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { PersonaEditor } from "@/components/runs/persona-editor";
import { personasView } from "@/lib/server/runs/personas";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  const translate = await getTranslations("ui");

  return (
    <PageMessages path="/admin/personas">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("mfa2ea3fb081c")}
            description={translate("m519f46762642")}
          />
          <PersonaEditor initial={await personasView()} />
        </div>
      }
    </PageMessages>
  );
}
