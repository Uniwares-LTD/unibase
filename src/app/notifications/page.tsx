import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";
import { PageMessages } from "@/components/page-messages";
import { PageHeader } from "@/components/page-patterns";
import { pageSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { notificationPage } from "@/lib/server/notifications";
import { NotificationInbox } from "@/components/notifications";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m788011833a5a") };
}
export default async function Page() {
  const translate = await getTranslations("ui");
  const actor = await pageSession(false);
  const initial = await notificationPage(
    database(),
    actor.uid,
    undefined,
    (await requestLocale()).locale,
  );
  return (
    <PageMessages path="/notifications">
      <div className="max-w-3xl page-stack">
        <PageHeader
          title={translate("m788011833a5a")}
          description={translate("md4a89066c709")}
        />
        <NotificationInbox initial={initial} />
      </div>
    </PageMessages>
  );
}
