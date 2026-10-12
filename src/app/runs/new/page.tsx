import { RunLanding } from "@/components/runs/run-ui";
import { orchestrators } from "@/lib/server/runs/orchestrators";
import { listRuns } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  const [choices, runs] = await Promise.all([
    orchestrators(false, true),
    listRuns(),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Start a run"
        description="Choose an orchestrator and build with AI."
      />
      <RunLanding
        choices={choices}
        unfinished={runs.rows.filter(
          (r) => !["succeeded", "failed", "cancelled"].includes(r.status),
        )}
      />
    </div>
  );
}
