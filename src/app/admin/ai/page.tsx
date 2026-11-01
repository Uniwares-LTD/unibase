import { formatAdminNumber } from "@/lib/admin-labels";
import { DateLabel } from "@/components/localized-value";
import { AdminStateLabel as StateLabel } from "@/components/admin-state-label";
import { PageMessages } from "@/components/page-messages";
import { getFormatter } from "next-intl/server";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-patterns";
import { AiResolution } from "@/components/ai-resolution";
import { adminPageSession } from "@/lib/server/admin-view";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export async function generateMetadata() {
  return { title: "AI operations" };
}
function UserLink({ uid }: { uid: string }) {
  return (
    <Link
      className="break-all font-mono text-xs underline"
      href={`/admin/users/${encodeURIComponent(uid)}`}
    >
      <bdi>{uid}</bdi>
    </Link>
  );
}
export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const format = await getFormatter();

  await adminPageSession();
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
  const unknown = "Unknown";
  return (
    <PageMessages path="/admin/ai">
      <div className="page-stack">
        <PageHeader
          title="AI operations"
          description="Resolve uncertain executions and inspect provider usage independently of application credits."
          actions={
            <Button variant="outline" asChild>
              <Link href="/admin/operations">
                Worker health, payments and cleanup
              </Link>
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>
              {(summary.queued === 1
                ? formatAdminNumber(summary.queued) + " active execution"
                : formatAdminNumber(summary.queued) + " active executions") +
                " · oldest " +
                (summary.queueAgeSeconds ?? 0) +
                " seconds · " +
                summary.unresolved +
                " need review"}
            </CardTitle>
            <CardDescription>
              Check worker health first. Accept only saved successful results
              with billing evidence; otherwise record the evidence and release
              the credits.
            </CardDescription>
          </CardHeader>
        </Card>
        <section className="space-y-4" aria-labelledby="ai-review">
          <div>
            <h2 id="ai-review" className="text-xl font-semibold">
              Executions needing review
            </h2>
            <p className="text-sm text-muted-foreground">
              Oldest first, 25 per page. Resolving requires administrator
              access.
            </p>
          </div>
          {!jobs.length && (
            <EmptyState
              title="No executions need review."
              description="Uncertain executions appear here for resolution."
            />
          )}
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {job.capability} · <StateLabel value={job.status} />
                </CardTitle>
                <CardDescription>
                  {"Up to " +
                    (job.credits === 1
                      ? formatAdminNumber(job.credits) + " credit"
                      : formatAdminNumber(job.credits) + " credits") +
                    " reserved"}{" "}
                  · {job.failure ?? "Reconciliation required"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">Job</dt>
                  <dd className="break-all font-mono text-xs">
                    <bdi>{job.id}</bdi>
                  </dd>
                  <dt className="text-muted-foreground">User</dt>
                  <dd>
                    <UserLink uid={job.uid} />
                  </dd>
                  <dt className="text-muted-foreground">Provider execution</dt>
                  <dd className="break-all font-mono text-xs">
                    {job.runId ? <bdi>{job.runId}</bdi> : unknown}
                  </dd>
                </dl>
                <AiResolution jobId={job.id} canAccept={job.canAccept} />
              </CardContent>
            </Card>
          ))}
          {(cursor || page.next) && (
            <div className="flex flex-wrap gap-3">
              {cursor && (
                <Button asChild variant="outline">
                  <Link href="/admin/ai">First page</Link>
                </Button>
              )}
              {page.next && (
                <Button asChild>
                  <Link
                    href={`/admin/ai?cursor=${encodeURIComponent(page.next)}`}
                  >
                    Next review page
                  </Link>
                </Button>
              )}
            </div>
          )}
        </section>
        <section className="space-y-3" aria-labelledby="ai-usage">
          <div>
            <h2 id="ai-usage" className="text-xl font-semibold">
              Latest usage observations
            </h2>
            <p className="text-sm text-muted-foreground">
              Latest 100 observations. Token counts can overlap; unknown cost is
              not zero, simulated records are not real spend, and currencies are
              not converted.
            </p>
          </div>
          {usage.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability / user</TableHead>
                  <TableHead>Provider / scope</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Reported cost</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Settled credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p>{item.capability}</p>
                      <UserLink uid={item.uid} />
                      <p
                        className="max-w-48 truncate font-mono text-xs"
                        title={item.jobId}
                      >
                        {item.jobId}
                      </p>
                    </TableCell>
                    <TableCell>
                      {item.provider} / <StateLabel value={item.scope} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.totalTokens == null
                        ? unknown
                        : format.number(item.totalTokens)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.cost ? (
                        <bdi>
                          {format.number(Number(item.cost.amount), {
                            maximumFractionDigits: 18,
                          })}{" "}
                          {item.cost.currency}
                        </bdi>
                      ) : (
                        unknown
                      )}
                    </TableCell>
                    <TableCell>
                      <DateLabel value={item.timestamp} />
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.scope === "execution"
                        ? item.settledCredits == null
                          ? "Pending"
                          : format.number(item.settledCredits)
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
          ) : (
            <EmptyState
              title="No usage observations yet."
              description="Provider usage appears here after executions run."
            />
          )}
        </section>
      </div>
    </PageMessages>
  );
}
