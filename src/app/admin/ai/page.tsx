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

export const metadata = { title: "AI operations" };
export default async function AdminAiPage() {
  const [jobs, usage] = await Promise.all([
    listAdminAiJobs(),
    listAdminAiUsage(),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="AI operations"
        description="Resolve uncertain executions and inspect provider usage independently of application credits."
      />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Executions needing review</h2>
        <p className="text-sm text-muted-foreground">
          Oldest 50 unresolved executions. Resolution requires a recent
          administrator sign-in.
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!usage.length && <p>No usage observations yet.</p>}
      </section>
    </div>
  );
}
