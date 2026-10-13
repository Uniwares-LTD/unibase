import { requestLocale } from "@/lib/server/locale";
import { PageMessages } from "@/components/page-messages";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { notificationPage } from "@/lib/server/notifications";
import { NotificationInbox } from "@/components/notifications";
export default async function Page() {
  const actor = await requireSession(false);
  return (
    <PageMessages path="/notifications">
      {
        <NotificationInbox
          initial={await notificationPage(
            database(),
            actor.uid,
            undefined,
            (await requestLocale()).locale,
          )}
        />
      }
    </PageMessages>
  );
}
