import {
  StateLabel,
  DateLabel,
  NumberLabel,
} from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { listRuns } from "@/lib/server/runs/service";
import { EmptyState, PageHeader } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Filter values accepted by listRuns, labelled with the matching display status.
const filters = [
  ["all", "all"],
  ["queued", "queued"],
  ["running", "running"],
  ["paused", "awaiting input"],
  ["unknown", "reconciling"],
  ["needs-review", "needs-review"],
  ["succeeded", "succeeded"],
  ["partial", "partially completed"],
  ["failed", "failed"],
  ["cancelled", "cancelled"],
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m848f54e89660") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; status?: string }>;
}) {
  const translate = await getTranslations("ui");

  const q = await searchParams;
  const data = await listRuns(q.cursor, q.status);
  const active = q.status ?? "all";
  const statusQuery = q.status ? `status=${encodeURIComponent(q.status)}` : "";
  return (
    <PageMessages path="/runs">
      <div className="page-stack">
        <PageHeader
          title={translate("m848f54e89660")}
          description={translate("m9f45d2baab84")}
          actions={
            <Button asChild>
              <Link href="/runs/new">{translate("m9f88e18da1c5")}</Link>
            </Button>
          }
        />
        <nav
          aria-label={translate("m50a126c9b501")}
          className="flex flex-wrap gap-2"
        >
          {filters.map(([value, label]) => (
            <Button
              key={value}
              asChild
              size="sm"
              variant={active === value ? "secondary" : "ghost"}
            >
              <Link
                href={value === "all" ? "/runs" : `/runs?status=${value}`}
                aria-current={active === value ? "page" : undefined}
              >
                <StateLabel value={label} />
              </Link>
            </Button>
          ))}
        </nav>
        {data.rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{translate("mbee02d257b7c")}</TableHead>
                <TableHead>{translate("mdeb54f8a3538")}</TableHead>
                <TableHead>{translate("m9f229358e545")}</TableHead>
                <TableHead>{translate("me2e775f30476")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/runs/${run.id}`}
                    >
                      {run.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StateLabel value={run.status} />
                  </TableCell>
                  <TableCell>
                    <NumberLabel value={run.attempts} />
                  </TableCell>
                  <TableCell>
                    <DateLabel value={run.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : q.status && !q.cursor ? (
          <div className="space-y-3">
            <EmptyState
              title={translate("mcb074640fe0a")}
              description={translate("m091c15169598")}
            />
            <Button asChild variant="outline">
              <Link href="/runs">{translate("m1ccf41dcc603")}</Link>
            </Button>
          </div>
        ) : (
          <EmptyState
            title={translate("m5e7f76ade9b6")}
            description={translate("m37b60686bc2d")}
          />
        )}
        {(data.next || q.cursor) && (
          <div className="flex flex-wrap gap-2">
            {q.cursor && (
              <Button asChild variant="outline">
                <Link href={statusQuery ? `/runs?${statusQuery}` : "/runs"}>
                  {translate("m668aaaf7a5ab")}
                </Link>
              </Button>
            )}
            {data.next && (
              <Button asChild variant="outline">
                <Link
                  href={`/runs?cursor=${encodeURIComponent(data.next)}${statusQuery ? `&${statusQuery}` : ""}`}
                >
                  {translate("m5a0522cb269a")}
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </PageMessages>
  );
}
