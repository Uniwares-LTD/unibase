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

export const metadata: Metadata = { title: "Reports" };
const labels: Record<string, string> = {
  role: "Role",
  status: "Status",
  displayName: "Display name",
  balance: "Balance",
  debt: "Debt",
};
const describe = (value?: Record<string, string | number>) =>
  Object.entries(value ?? {})
    .map(([key, val]) => `${labels[key] ?? key}: ${val}`)
    .join("; ") || "—";
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
    <div className="page-stack">
      <PageHeader
        title="Reports"
        description="Filter recorded application events and administrator changes."
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filters.kind === "runtime" ? "default" : "outline"}
          asChild
        >
          <Link href="/admin/reports?kind=runtime">Runtime logs</Link>
        </Button>
        <Button
          variant={filters.kind === "audit" ? "default" : "outline"}
          asChild
        >
          <Link href="/admin/reports?kind=audit">Admin audit</Link>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {filters.kind === "runtime"
          ? "Structured application events from the last 30 days. Storage is best-effort; missing events may still be in operator stdout logs. Bodies, messages, stacks, tokens and query strings are excluded."
          : "Permanent administrator changes with actors, targets and recorded reasons. Ledger history is on each user’s account."}
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportFiltersForm key={JSON.stringify(filters)} filters={filters} />
        </CardContent>
      </Card>
      {!report && (
        <Notice tone="error" title="Check the report filters and date range." />
      )}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle>
              {report.kind === "runtime"
                ? "Runtime events"
                : "Administrator audit"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.rows.length ? (
              report.kind === "runtime" ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "When (UTC)",
                        "Event",
                        "Severity",
                        "Status",
                        "Duration",
                        "Request ID",
                      ].map((title) => (
                        <TableHead key={title}>{title}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {row.timestamp.replace("T", " ").replace("Z", "")}
                        </TableCell>
                        <TableCell>{row.event}</TableCell>
                        <TableCell>{row.severity}</TableCell>
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
                        "When (UTC)",
                        "Event",
                        "Actor / target",
                        "Change and reason",
                      ].map((title) => (
                        <TableHead key={title}>{title}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          {row.timestamp.replace("T", " ").replace("Z", "")}
                        </TableCell>
                        <TableCell>{row.event}</TableCell>
                        <TableCell>
                          <div className="w-48 break-all whitespace-normal text-xs">
                            <p>Actor: {row.actorUid}</p>
                            <p>Target: {row.targetUid}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="w-64 space-y-2 break-words whitespace-normal text-xs">
                            <p>Before: {describe(row.before)}</p>
                            <p>After: {describe(row.after)}</p>
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
                title="No matching records."
                description="Adjust the filters or return to the latest records."
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" asChild>
                <Link
                  href={`/admin/reports?${new URLSearchParams([...next].filter(([key]) => key !== "cursor"))}`}
                >
                  Latest records
                </Link>
              </Button>
              {report.nextCursor && (
                <Button variant="outline" asChild>
                  <Link href={`/admin/reports?${next}`}>Older records</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
