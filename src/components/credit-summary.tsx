import { EmptyState, Notice } from "./page-patterns";
import Link from "next/link";
import type { CreditAccount } from "@/lib/contracts/credits";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./ui/table";

const eventNames: Record<string, string> = {
  grant: "Credit grant",
  deduction: "Admin deduction",
  reserve: "Reserved",
  commit: "Spent",
  release: "Released",
  "hold-expired": "Hold timed out",
  "hold-cancelled": "Hold cancelled",
  expiry: "Credits expired",
  "purchase-reversal": "Purchase reversed",
  "purchase-restoration": "Purchase restored",
};
const date = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
export function CreditSummary({
  account,
  historyPath,
}: {
  account: CreditAccount;
  historyPath: string;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Available", account.available],
          ["Reserved", account.reserved],
          ["Debt", account.debt],
          ["Net balance", account.balance],
        ].map(([label, number]) => (
          <Card
            key={label}
            className={
              label === "Available"
                ? "border-primary/25 bg-secondary/40"
                : undefined
            }
          >
            <CardHeader>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-all text-3xl tabular-nums">
                {number.toLocaleString("en-GB")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      {account.debt > 0 && (
        <Notice tone="warning" title="Outstanding credit debt">
          Spending is blocked until the outstanding debt is covered. New credits
          pay off debt first.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming expiry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Next 10 grants with available credits. Dates are UTC.
            </p>
            {account.upcoming.length ? (
              <ul className="space-y-2">
                {account.upcoming.map((item, i) => (
                  <li key={i}>
                    {item.credits.toLocaleString("en-GB")} credits ·{" "}
                    {date(item.expiresAt)} UTC
                  </li>
                ))}
              </ul>
            ) : (
              <p>No available credits scheduled to expire.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active holds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Up to 25 current holds. Temporary holds last 15 minutes. AI holds
              remain reserved until the execution is resolved.
            </p>
            {account.holds.length ? (
              <ul className="space-y-2">
                {account.holds.map((item) => (
                  <li key={item.id}>
                    {item.credits.toLocaleString("en-GB")} credits ·{" "}
                    {item.managedJobId
                      ? "AI execution pending"
                      : `until ${date(item.expiresAt)} UTC`}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No credits currently held.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Credit history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {account.history.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When (UTC)</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Holds</TableHead>
                  <TableHead>Balance after</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {account.history.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">
                      {date(item.timestamp)}
                    </TableCell>
                    <TableCell>
                      <p>{eventNames[item.kind] ?? "Credit event"}</p>
                      {item.reason && (
                        <p className="max-w-xs break-words text-xs text-muted-foreground">
                          {item.reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.delta > 0 ? "+" : ""}
                      {item.delta}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.reservedDelta > 0 ? "+" : ""}
                      {item.reservedDelta}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {item.balanceAfter}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="No credit activity yet"
              description="Grants, purchases and other credit changes will appear here."
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link href={historyPath}>Latest activity</Link>
            </Button>
            {account.nextBefore && (
              <Button variant="outline" asChild>
                <Link href={`${historyPath}?before=${account.nextBefore}`}>
                  Older activity
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
