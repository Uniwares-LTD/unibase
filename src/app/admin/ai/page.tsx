import { StateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata() {
  return { title: (await getTranslations("ui"))("m6a2e5e0ed2df") };
}
export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const translate = await getTranslations("ui");

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
    <PageMessages path="/admin/ai">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m6a2e5e0ed2df")}
            description={translate("mef30fbe8fba2")}
          />
          <p>
            {summary.queued} {translate("mca0bdc1af688")}{" "}
            {summary.queueAgeSeconds ?? 0}
            {translate("mc2d3f07805f1")} {summary.unresolved}{" "}
            {translate("m727a2b15b9c1")}{" "}
          </p>
          <p>{translate("ma9e95902e378")} </p>
          <Link className="underline" href="/admin/operations">
            {translate("m2c4eca1ae1d9")}{" "}
          </Link>
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">
              {translate("m32b9928815c9")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("md76e07b2a26c")}{" "}
            </p>
            {!jobs.length && <p>{translate("m42101b166a60")}</p>}
            {jobs.map((job) => (
              <Card key={job.id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {job.capability} · <StateLabel value={job.status} />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="break-all text-xs">
                    {translate("m34b0e24b358e")} {job.id}
                    <br />
                    {translate("m93d6b3e9b86e")} <bdi>{job.uid}</bdi>
                    <br />
                    {translate("meb139e550539")}{" "}
                    {job.runId ?? translate("mb764cdc0eab7")}
                  </p>
                  <p className="text-sm">
                    {job.credits} {translate("mba034b7065c4")}{" "}
                    {job.failure ?? translate("m3d68c1a96f89")}
                  </p>
                  <AiResolution jobId={job.id} canAccept={job.canAccept} />
                </CardContent>
              </Card>
            ))}
          </section>
          <div className="flex gap-3">
            <Button asChild variant="outline">
              <Link href="/admin/ai">{translate("m6e2ebdab3c02")}</Link>
            </Button>
            {page.next && (
              <Button asChild>
                <Link
                  href={`/admin/ai?cursor=${encodeURIComponent(page.next)}`}
                >
                  {translate("m7b4136c664d7")}{" "}
                </Link>
              </Button>
            )}
          </div>
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              {translate("m35a40961b140")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {translate("mc383a13649b1")}{" "}
            </p>
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
                      <Link
                        className="break-all text-xs underline"
                        href={`/admin/users/${encodeURIComponent(item.uid)}`}
                      >
                        <bdi>{item.uid}</bdi>
                      </Link>
                      <p
                        className="max-w-48 truncate text-xs"
                        title={item.jobId}
                      >
                        {item.jobId}
                      </p>
                    </TableCell>
                    <TableCell>
                      {item.provider} / {item.scope}
                    </TableCell>
                    <TableCell>
                      {item.totalTokens ?? translate("mb764cdc0eab7")}
                    </TableCell>
                    <TableCell>
                      {item.cost
                        ? `${item.cost.amount} ${item.cost.currency}`
                        : translate("mb764cdc0eab7")}
                    </TableCell>
                    <TableCell>
                      {item.timestamp.slice(0, 19).replace("T", " ")}
                    </TableCell>
                    <TableCell>
                      {item.scope === "execution"
                        ? (item.settledCredits ?? translate("m331551b0de41"))
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
            {!usage.length && <p>{translate("m8a62c4d5e81c")}</p>}
          </section>
        </div>
      }
    </PageMessages>
  );
}
