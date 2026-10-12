import { PersonaEditor } from "@/components/runs/persona-editor";
import { personasView } from "@/lib/server/runs/personas";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  return (
    <div className="page-stack">
      <PageHeader
        title="Personas"
        description="Configure who answers workflow questions and their responder pricing."
      />
      <PersonaEditor initial={await personasView()} />
    </div>
  );
}
