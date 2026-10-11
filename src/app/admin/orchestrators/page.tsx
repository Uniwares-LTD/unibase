import { OrchestratorEditor } from "@/components/runs/admin-editors";
import { orchestrators } from "@/lib/server/runs/orchestrators";
import { requireAdmin } from "@/lib/server/admin";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  await requireAdmin();
  return (
    <div className="page-stack">
      <PageHeader
        title="Orchestrators"
        description="Choose available orchestrators and manage Dify definitions."
      />
      <OrchestratorEditor initial={await orchestrators(true)} />
    </div>
  );
}
