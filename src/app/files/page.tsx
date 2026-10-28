import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { pageSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { listFiles } from "@/lib/server/private-files";
import { Files } from "@/components/files";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("mabc7e9892806") };
}

export default async function Page() {
  const actor = await pageSession();
  return (
    <PageMessages path="/files">
      <Files initial={await listFiles(database(), actor.uid)} />
    </PageMessages>
  );
}
