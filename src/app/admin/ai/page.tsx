import { DateLabel, StateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getFormatter, getTranslations } from "next-intl/server";
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
  return { title: (await getTranslations("ui"))("m6a2e5e0ed2df") };
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
  const translate = await getTranslations("ui");
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
  const unknown = translate("mb764cdc0eab7");
  return (
    <PageMessages path="/admin/ai">
      <div className="page-stack">
        <PageHeader
          title={translate("m6a2e5e0ed2df")}
          description={translate("mef30fbe8fba2")}
          actions={
            <Button variant="outline" asChild>
              <Link href="/admin/operations">{translate("m2c4eca1ae1d9")}</Link>
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>
              {translate("m6b1761d93b24", {
                count: summary.queued,
                seconds: summary.queueAgeSeconds ?? 0,
                review: summary.unresolved,
              })}
            </CardTitle>
            <CardDescription>{translate("ma9e95902e378")}</CardDescription>
          </CardHeader>
        </Card>
        <section className="space-y-4" aria-labelledby="ai-review">
          <div>
            <h2 id="ai-review" className="text-xl font-semibold">
              {translate("m32b9928815c9")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("md76e07b2a26c")}
            </p>
          </div>
          {!jobs.length && (
            <EmptyState
              title={translate("m42101b166a60")}
              description={translate("m70125e5c8822")}
            />
          )}
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {job.capability} · <StateLabel value={job.status} />
                </CardTitle>
                <CardDescription>
                  {translate("m4aa83b5db5c2", { credits: job.credits })} ·{" "}
                  {job.failure ?? translate("m3d68c1a96f89")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="text-muted-foreground">
                    {translate("mc52f1b7e3c78")}
                  </dt>
                  <dd className="break-all font-mono text-xs">
                    <bdi>{job.id}</bdi>
                  </dd>
                  <dt className="text-muted-foreground">
                    {translate("mcebc9d5e96c2")}
                  </dt>
                  <dd>
                    <UserLink uid={job.uid} />
                  </dd>
                  <dt className="text-muted-foreground">
                    {translate("m3925579b2387")}
                  </dt>
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
                  <Link href="/admin/ai">{translate("m9f410341c431")}</Link>
                </Button>
              )}
              {page.next && (
                <Button asChild>
                  <Link
                    href={`/admin/ai?cursor=${encodeURIComponent(page.next)}`}
                  >
                    {translate("m7b4136c664d7")}
                  </Link>
                </Button>
              )}
            </div>
          )}
        </section>
        <section className="space-y-3" aria-labelledby="ai-usage">
          <div>
            <h2 id="ai-usage" className="text-xl font-semibold">
              {translate("m35a40961b140")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("mc383a13649b1")}
            </p>
          </div>
          {usage.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{translate("mb33765682791")}</TableHead>
                  <TableHead>{translate("m762615fccde4")}</TableHead>
                  <TableHead>{translate("ma039dfb9628b")}</TableHead>
                  <TableHead>{translate("mf58870719676")}</TableHead>
                  <TableHead>{translate("mda59e0e45c51")}</TableHead>
                  <TableHead>{translate("m5da7e2fe0b5b")}</TableHead>
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
                          ? translate("m331551b0de41")
                          : format.number(item.settledCredits)
                        : "—"}
                      {item.parentAttemptId && (
                        <p
                          className="max-w-48 truncate text-xs"
                          title={item.parentAttemptId}
                        >
                          {translate("mcaf27a22a958")} {item.parentAttemptId}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title={translate("m8a62c4d5e81c")}
              description={translate("ma4fbf41fc63e")}
            />
          )}
        </section>
      </div>
    </PageMessages>
  );
}
