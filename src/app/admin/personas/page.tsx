import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { PersonaEditor } from "@/components/runs/persona-editor";
import { personasView } from "@/lib/server/runs/personas";
import { PageHeader } from "@/components/page-patterns";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("mfa2ea3fb081c") };
}
export default async function Page() {
  const translate = await getTranslations("ui");

  await adminPageSession();
  return (
    <PageMessages path="/admin/personas">
      <div className="page-stack">
        <PageHeader
          title={translate("mfa2ea3fb081c")}
          description={translate("m519f46762642")}
        />
        <PersonaEditor initial={await personasView()} />
      </div>
    </PageMessages>
  );
}
