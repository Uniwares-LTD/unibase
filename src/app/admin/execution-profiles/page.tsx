import { adminPageSession } from "@/lib/server/admin-view";
import { database } from "@/lib/server/mongo";
import { listExecutionProfiles } from "@/lib/server/workspaces/profiles";
import { ExecutionProfiles } from "@/components/workspaces/execution-profiles";
import { PageHeader } from "@/components/page-patterns";
export const metadata = { title: "Execution profiles" };
export default async function Page() {
  const actor = await adminPageSession();
  return (
    <div className="page-stack">
      <PageHeader
        title="Execution profiles"
        description="Publish reusable instructions and execution settings. Existing batches retain their saved revisions."
      />
      <ExecutionProfiles
        uid={actor.uid}
        initial={await listExecutionProfiles(database())}
      />
    </div>
  );
}
