import Link from "next/link";
import { listRuns } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const q = await searchParams;
  const data = await listRuns(q.cursor, q.status);
  return (
    <div className="page-stack">
      <PageHeader
        title="Runs"
        description="Your orchestrator executions, decisions, and results."
      />
      <Button asChild>
        <Link href="/runs/new">Start a run</Link>
      </Button>
      <nav aria-label="Run status filters" className="flex flex-wrap gap-3">
        {[
          "all",
          "queued",
          "unknown",
          "cancelled",
          "partial",
          "running",
          "paused",
          "succeeded",
          "failed",
          "needs-review",
        ].map((status) => (
          <Link
            key={status}
            className="underline"
            href={status === "all" ? "/runs" : `/runs?status=${status}`}
          >
            {status === "paused"
              ? "Awaiting input"
              : status === "unknown"
                ? "Reconciling"
                : status === "partial"
                  ? "Partially completed"
                  : status}
          </Link>
        ))}
      </nav>
      {data.rows.map((run) => (
        <div className="rounded-lg border p-4" key={run.id}>
          <Link className="font-semibold underline" href={`/runs/${run.id}`}>
            {run.name}
          </Link>
          <p>
            {run.status} ? {run.attempts} attempt(s) ? {run.createdAt}
          </p>
        </div>
      ))}
      {!data.rows.length && <p>No runs yet.</p>}
      {data.next && (
        <Link
          className="underline"
          href={`/runs?cursor=${encodeURIComponent(data.next)}${q.status ? `&status=${q.status}` : ""}`}
        >
          Older runs
        </Link>
      )}
    </div>
  );
}
