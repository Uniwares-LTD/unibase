import { PageMessages } from "@/components/page-messages";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { listFiles } from "@/lib/server/private-files";
import { Files } from "@/components/files";
export default async function Page() {
  const actor = await requireSession();
  return (
    <PageMessages path="/files">
      {<Files initial={await listFiles(database(), actor.uid)} />}
    </PageMessages>
  );
}
