import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import Link from "next/link";
import { adminPageSession } from "@/lib/server/admin-view";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { administratorDashboard } from "@/lib/server/reports";

export const metadata: Metadata = { title: "Administration" };
export default async function AdminPage() {
  await adminPageSession();
  const metrics = await administratorDashboard();
  return (
    <div className="page-stack">
      <PageHeader
        title="Administration"
        description="Account access, credits and operational reports."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Application profiles", metrics.profiles],
          ["Active admins", metrics.admins],
          ["Suspended accounts", metrics.suspended],
          ["Recorded errors · 24h", metrics.runtimeErrors],
          ["Audited changes · 24h", metrics.auditedChanges],
        ].map(([label, count]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="break-all text-3xl tabular-nums">
                {count.toLocaleString("en-GB")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Profile count covers accounts that have entered the application. Runtime
        error totals reflect events successfully stored.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>User management</CardTitle>
          <CardDescription>
            Manage account access, administrator roles and application profiles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/admin/users">Manage users</Link>
          </Button>
        </CardContent>
      </Card>
      <Button variant="outline" asChild>
        <Link href="/admin/reports">View reports</Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href="/admin/execution-profiles">Execution profiles</Link>
      </Button>
    </div>
  );
}
