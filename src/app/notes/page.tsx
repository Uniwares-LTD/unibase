// Sample: notes. Remove with `npm run samples:remove -- notes`. The proxy gates
// /notes by its module, like core module routes.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageMessages } from "@/components/page-messages";
import { PageHeader } from "@/components/page-patterns";
import { pageSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { listNotes } from "@/samples/notes/store";
import { NotesPanel } from "@/samples/notes/notes-panel";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m8a7525b1492f") };
}

export default async function Page() {
  const translate = await getTranslations("ui");
  const actor = await pageSession();
  const { rows } = await listNotes(database(), actor.uid);
  return (
    <PageMessages path="/notes">
      <div className="max-w-3xl page-stack">
        <PageHeader
          title={translate("m8a7525b1492f")}
          description={translate("m205655852b1b")}
        />
        <NotesPanel initial={rows} />
      </div>
    </PageMessages>
  );
}
