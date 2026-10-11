import { RunDetail } from "@/components/runs/run-ui";
import { runDetail } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const data = await runDetail((await params).id);
  return (
    <div className="page-stack">
      <PageHeader
        title={data.name}
        description="Follow progress, answer decisions, and inspect results."
      />
      <RunDetail initial={data} />
    </div>
  );
}
