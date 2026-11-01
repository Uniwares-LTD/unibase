import { PageMessages } from "@/components/page-messages";

import type { Metadata } from "next";
import { adminPageSession } from "@/lib/server/admin-view";
import { PersonaEditor } from "@/components/runs/persona-editor";
import { personasView } from "@/lib/server/runs/personas";
import { PageHeader } from "@/components/page-patterns";
export async function generateMetadata(): Promise<Metadata> {
  return { title: "Personas" };
}
export default async function Page() {
  await adminPageSession();
  return (
    <PageMessages path="/admin/personas">
      <div className="page-stack">
        <PageHeader
          title="Personas"
          description="Configure who answers workflow questions and their responder pricing."
        />
        <PersonaEditor initial={await personasView()} />
      </div>
    </PageMessages>
  );
}
