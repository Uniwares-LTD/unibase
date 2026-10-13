import { PageMessages } from "@/components/page-messages";
import { getTranslations, getFormatter } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m4b42c6690ebe") };
}
export default async function AdminPage() {
  const translate = await getTranslations("ui");

  await adminPageSession();
  const format = await getFormatter();
  const metrics = await administratorDashboard();
  return (
    <PageMessages path="/admin">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m4b42c6690ebe")}
            description={translate("m419e6b755e78")}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [translate("md6923f4d988c"), metrics.profiles],
              [translate("m8e82177f54fb"), metrics.admins],
              [translate("m1819c4bcc007"), metrics.suspended],
              [translate("m35fab64be703"), metrics.runtimeErrors],
              [translate("m407c22231232"), metrics.auditedChanges],
            ].map(([label, count]) => (
              <Card key={label}>
                <CardHeader>
                  <CardTitle className="text-sm">{label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="break-all text-3xl tabular-nums">
                    {typeof count === "number" ? format.number(count) : count}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {translate("m9dfde3fc0cef")}{" "}
          </p>
          <Card>
            <CardHeader>
              <CardTitle>{translate("m5a35ce25a2bd")}</CardTitle>
              <CardDescription>{translate("mb8766be60414")} </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/admin/users">{translate("m58606e582452")}</Link>
              </Button>
            </CardContent>
          </Card>
          <Button variant="outline" asChild>
            <Link href="/admin/reports">{translate("m2162217c92ce")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/settings">{translate("m667f51f3c86a")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/orchestrators">
              {translate("m9375b0d5e9f0")}
            </Link>
          </Button>
        </div>
      }
    </PageMessages>
  );
}
