import { PageMessages } from "@/components/page-messages";
import { getTranslations, getFormatter } from "next-intl/server";
import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
import { adminSections } from "./sections";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m4b42c6690ebe") };
}
export default async function AdminPage() {
  const translate = await getTranslations("ui");

  await adminPageSession();
  const format = await getFormatter();
  const metrics = await administratorDashboard();
  const sections = await adminSections();
  return (
    <PageMessages path="/admin">
      <div className="page-stack">
        <PageHeader
          title={translate("md4b1ea5708dd")}
          description={translate("m419e6b755e78")}
        />
        <section className="space-y-3" aria-labelledby="admin-metrics">
          <h2 id="admin-metrics" className="sr-only">
            {translate("md4b1ea5708dd")}
          </h2>
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
            {translate("m9dfde3fc0cef")}
          </p>
        </section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(({ href, label, description }) => (
            <Card key={href} className="shadow-none">
              <CardHeader>
                <CardTitle>{label}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button variant="outline" asChild>
                  <Link href={href}>
                    {label}
                    <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageMessages>
  );
}
