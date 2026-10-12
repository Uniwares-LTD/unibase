import Link from "next/link";
import { PageHeader } from "@/components/page-patterns";
import { AiResolution } from "@/components/ai-resolution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAdminAiJobs, listAdminAiUsage } from "@/lib/server/ai/service";
import { operationsSummary } from "@/lib/server/operations";
import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/auth-policy";
import { redirect } from "next/navigation";

export const metadata = { title: "AI operations" };
export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [page, usage, summary] = await Promise.all([
    listAdminAiJobs(cursor).catch((error: unknown) => {
      if (error instanceof AppError && error.code === "INVALID_CURSOR")
        redirect("/admin/ai");
      throw error;
    }),
    listAdminAiUsage(),
    operationsSummary(),
  ]);
  const jobs = page.jobs;
  return (
    <div className="page-stack">
      <PageHeader
        title="AI operations"
        description="Resolve uncertain executions and inspect provider usage independently of application credits."
      />
      <p>
        {summary.queued} active executions · oldest age{" "}
        {summary.queueAgeSeconds ?? 0}s · {summary.unresolved} require review.
      </p>
      <p>
        First check worker health and restore the original provider binding if
        needed. Accept only saved successful results with billing evidence.
        Otherwise record the evidence and release credits as a waiver; this does
        not stop uncertain provider work.
      </p>
      <Link className="underline" href="/admin/operations">
        Worker health, payments and cleanup
      </Link>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Executions needing review</h2>
        <p className="text-sm text-muted-foreground">
          Unresolved executions, oldest first, 25 per page. Resolution requires
          a recent administrator sign-in.
        </p>
        {!jobs.length && <p>No executions need review.</p>}
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {job.capability} · {job.status}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all text-xs">
                Job: {job.id}
                <br />
                User: {job.uid}
                <br />
                Provider execution: {job.runId ?? "Unknown"}
              </p>
              <p className="text-sm">
                {job.credits} maximum reserved credits ·{" "}
                {job.failure ?? "Reconciliation required"}
              </p>
              <AiResolution jobId={job.id} canAccept={job.canAccept} />
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/admin/ai">Oldest first</Link>
        </Button>
        {page.next && (
          <Button asChild>
            <Link href={`/admin/ai?cursor=${encodeURIComponent(page.next)}`}>
              Next review page
            </Link>
          </Button>
        )}
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Latest usage observations</h2>
        <p className="text-sm text-muted-foreground">
          Latest 100 observations. Node and execution token counts can overlap.
          Unknown costs are not zero; simulated records are not provider spend.
          Currency amounts are not converted or combined.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Capability / user</TableHead>
              <TableHead>Provider / scope</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Reported cost</TableHead>
              <TableHead>Time (UTC)</TableHead>
              <TableHead>Settled credits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p>{item.capability}</p>
                  <Link
                    className="break-all text-xs underline"
                    href={`/admin/users/${encodeURIComponent(item.uid)}`}
                  >
                    {item.uid}
                  </Link>
                  <p className="max-w-48 truncate text-xs" title={item.jobId}>
                    {item.jobId}
                  </p>
                </TableCell>
                <TableCell>
                  {item.provider} / {item.scope}
                </TableCell>
                <TableCell>{item.totalTokens ?? "Unknown"}</TableCell>
                <TableCell>
                  {item.cost
                    ? `${item.cost.amount} ${item.cost.currency}`
                    : "Unknown"}
                </TableCell>
                <TableCell>
                  {item.timestamp.slice(0, 19).replace("T", " ")}
                </TableCell>
                <TableCell>
                  {item.scope === "execution"
                    ? (item.settledCredits ?? "Pending")
                    : "—"}
                  {item.parentAttemptId && (
                    <p
                      className="max-w-48 truncate text-xs"
                      title={item.parentAttemptId}
                    >
                      Paid with parent {item.parentAttemptId}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!usage.length && <p>No usage observations yet.</p>}
      </section>
    </div>
  );
}
