import { DateLabel, StateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, Notice } from "@/components/page-patterns";
import type { Metadata } from "next";
import Link from "next/link";
import { AppError } from "@/lib/auth-policy";
import { reportParameters, type ReportFilters } from "@/lib/contracts/reports";
import { administratorReports } from "@/lib/server/reports";
import { adminPageSession } from "@/lib/server/admin-view";
import { ReportFiltersForm } from "@/components/report-filters";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("mdacca3cba3f3") };
}
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const translate = await getTranslations("ui");
  const labels: Record<string, string> = {
    role: translate("m14736a2eb9f4"),
    status: translate("m920e413c7d41"),
    displayName: translate("m2b7f6a84de91"),
    balance: translate("md05e07b7c14e"),
    debt: translate("m026e2f9afbc7"),
  };
  const describe = (value?: Record<string, string | number>) =>
    Object.entries(value ?? {})
      .map(([key, val]) => `${labels[key] ?? key}: ${val}`)
      .join("; ") || "—";

  await adminPageSession();
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value))
      for (const part of value) params.append(key, part);
    else if (value !== undefined) params.set(key, value);
  }
  const report = await administratorReports(reportParameters(params)).catch(
    (error: unknown) => {
      if (error instanceof AppError && error.code === "INVALID_REPORT_FILTER")
        return null;
      throw error;
    },
  );
  const filters: ReportFilters = report?.filters ?? {
    kind: params.get("kind") === "audit" ? "audit" : "runtime",
  };
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && key !== "cursor") next.set(key, value);
  if (report?.nextCursor) next.set("cursor", report.nextCursor);
  return (
    <PageMessages path="/admin/reports">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("mdacca3cba3f3")}
            description={translate("m348352db53e4")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filters.kind === "runtime" ? "default" : "outline"}
              asChild
            >
              <Link href="/admin/reports?kind=runtime">
                {translate("m36d4ba8ec08d")}
              </Link>
            </Button>
            <Button
              variant={filters.kind === "audit" ? "default" : "outline"}
              asChild
            >
              <Link href="/admin/reports?kind=audit">
                {translate("m7bef383a41b9")}
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {filters.kind === "runtime"
              ? translate("m516858760886")
              : translate("m7dcbd8824b11")}
          </p>
          <Card>
            <CardHeader>
              <CardTitle>{translate("m546ebb8eb993")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ReportFiltersForm
                key={JSON.stringify(filters)}
                filters={filters}
              />
            </CardContent>
          </Card>
          {!report && (
            <Notice tone="error" title={translate("m660546dec247")} />
          )}
          {report && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {report.kind === "runtime"
                    ? translate("m3c7233dd5a5d")
                    : translate("m764343d9295e")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {report.rows.length ? (
                  report.kind === "runtime" ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            translate("ma4528df6c39b"),
                            translate("m4e1f49a9c8ae"),
                            translate("m5e9f98120dbe"),
                            translate("m920e413c7d41"),
                            translate("m4fc52a3c4c55"),
                            translate("md561f528baf7"),
                          ].map((title) => (
                            <TableHead key={title}>{title}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <DateLabel value={row.timestamp} utc />
                            </TableCell>
                            <TableCell>
                              <StateLabel value={row.event} />
                            </TableCell>
                            <TableCell>
                              <StateLabel value={row.severity} />
                            </TableCell>
                            <TableCell>{row.status ?? "—"}</TableCell>
                            <TableCell>
                              {row.durationMs === undefined
                                ? "—"
                                : `${row.durationMs} ms`}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-mono">
                                {row.requestId ?? "—"}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[
                            translate("ma4528df6c39b"),
                            translate("m4e1f49a9c8ae"),
                            translate("me2d52ebeb243"),
                            translate("m424afea39c64"),
                          ].map((title) => (
                            <TableHead key={title}>{title}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.rows.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>
                              <DateLabel value={row.timestamp} utc />
                            </TableCell>
                            <TableCell>
                              <StateLabel value={row.event} />
                            </TableCell>
                            <TableCell>
                              <div className="w-48 break-all whitespace-normal text-xs">
                                <p>
                                  {translate("mcf72bcca6c26")} {row.actorUid}
                                </p>
                                <p>
                                  {translate("m890d34fffcde")} {row.targetUid}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="w-64 space-y-2 break-words whitespace-normal text-xs">
                                <p>
                                  {translate("mc19f75585ade")}{" "}
                                  {describe(row.before)}
                                </p>
                                <p>
                                  {translate("m13f844407f91")}{" "}
                                  {describe(row.after)}
                                </p>
                                <p>{row.reason}</p>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )
                ) : (
                  <EmptyState
                    title={translate("m7c08cf52e3dc")}
                    description={translate("m9a70f3ed210b")}
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <Link
                      href={`/admin/reports?${new URLSearchParams([...next].filter(([key]) => key !== "cursor"))}`}
                    >
                      {translate("m2bd6e5d112dc")}{" "}
                    </Link>
                  </Button>
                  {report.nextCursor && (
                    <Button variant="outline" asChild>
                      <Link href={`/admin/reports?${next}`}>
                        {translate("m10a2e3a80b0c")}
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      }
    </PageMessages>
  );
}
