import { StateLabel, DateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-patterns";
import { AdminCleanup, PaymentReview } from "@/components/admin-operations";
import { adminPageSession } from "@/lib/server/admin-view";
import { Button } from "@/components/ui/button";
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
import {
  operationsSummary,
  cleanupReports,
  paymentOperations,
} from "@/lib/server/operations";
import { readSettings } from "@/lib/server/settings";
export async function generateMetadata() {
  return { title: (await getTranslations("ui"))("m358cc201f87d") };
}
export default async function OperationsPage() {
  const translate = await getTranslations("ui");
  const common = await getTranslations("common");

  await adminPageSession();
  const { settings } = await readSettings();
  const [summary, reports, payments] = await Promise.all([
    operationsSummary(),
    cleanupReports(),
    paymentOperations(),
  ]);
  return (
    <PageMessages path="/admin/operations">
      <div className="page-stack">
        <PageHeader
          title={translate("m358cc201f87d")}
          description={translate("mf42e7a16fa5e")}
          actions={
            <Button variant="outline" asChild>
              <Link href="/admin/ai">{translate("mdb59f8979df7")}</Link>
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>{translate("m5fb09750c87b")}</CardTitle>
            <CardDescription>{translate("m342c457b5f7c")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {summary.workers.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{translate("m05d41cd07984")}</TableHead>
                    <TableHead>{translate("m63d5bf22846d")}</TableHead>
                    <TableHead>{translate("m247a3dc2ade7")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.workers.map((w) => (
                    <TableRow key={w.kind}>
                      <TableCell>
                        <StateLabel value={w.kind} />
                      </TableCell>
                      <TableCell>
                        <StateLabel value={w.state} />
                      </TableCell>
                      <TableCell>
                        {w.ageSeconds === null
                          ? common("notReported")
                          : common("secondsAgo", { seconds: w.ageSeconds })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title={translate("m169450ea35de")}
                description={translate("m80c6dac89059")}
              />
            )}
            <p>
              {summary.paymentPending
                ? translate("me2090104504d", {
                    count: summary.paymentPending,
                    seconds: summary.paymentAgeSeconds ?? 0,
                  })
                : translate("mc00902deeed0")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{translate("mc9e1264f5def")}</CardTitle>
            <CardDescription>{translate("me5a3391be2de")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <PaymentReview enabled={summary.stripeEnabled} />
            <section className="space-y-3">
              <h3 className="font-semibold">{translate("mc77db1086fac")}</h3>
              {payments.orders.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{translate("mf808e400f5b9")}</TableHead>
                      <TableHead>{translate("m63d5bf22846d")}</TableHead>
                      <TableHead>{translate("mcebc9d5e96c2")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">
                          <bdi>{o.id}</bdi>
                        </TableCell>
                        <TableCell>
                          <StateLabel value={o.status} />
                        </TableCell>
                        <TableCell>
                          <Link
                            className="font-mono text-xs underline"
                            href={`/admin/users/${encodeURIComponent(o.uid)}`}
                          >
                            <bdi>{o.uid}</bdi>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title={translate("m81d429e85210")}
                  description={translate("mada127018fd0")}
                />
              )}
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">{translate("m5552a9df200b")}</h3>
              {payments.reviews.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{translate("mf808e400f5b9")}</TableHead>
                      <TableHead>{translate("m63d5bf22846d")}</TableHead>
                      <TableHead>{translate("mbfb2c437e72d")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.reviews.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">
                          <bdi>{r.orderId}</bdi>
                        </TableCell>
                        <TableCell>
                          <StateLabel value={r.state} />
                        </TableCell>
                        <TableCell>
                          <DateLabel value={r.createdAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title={translate("m00f836d67e63")}
                  description={translate("m73cad2013bf9")}
                />
              )}
            </section>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{translate("m00210238862e")}</CardTitle>
            <CardDescription>{translate("m3e5cf61fe610")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AdminCleanup defaultDays={settings.runs.cleanupDays} />
            <section className="space-y-3">
              <h3 className="font-semibold">{translate("m0aabfed81c23")}</h3>
              {reports.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{translate("mbfb2c437e72d")}</TableHead>
                      <TableHead>{translate("m63d5bf22846d")}</TableHead>
                      <TableHead>{translate("m392b784d73f6")}</TableHead>
                      <TableHead>{translate("mde81a3c550f0")}</TableHead>
                      <TableHead>{translate("m02354fbeafb9")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <DateLabel value={r.createdAt} />
                        </TableCell>
                        <TableCell>
                          <StateLabel value={r.state} />
                        </TableCell>
                        <TableCell>
                          {translate("m3d2a712d18ec", {
                            jobs: r.jobs,
                            files: r.files,
                            abandoned: r.abandonedUploads,
                          })}
                        </TableCell>
                        <TableCell>
                          {translate("mf011bbfa0471", {
                            changed: r.changed,
                            skipped: r.skipped,
                          })}
                        </TableCell>
                        <TableCell>
                          {translate("mae57704b8090", {
                            deleted: r.storageDeleted,
                            pending: r.storagePending,
                            failed: r.storageFailed,
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <EmptyState
                  title={translate("m1da65c87be1d")}
                  description={translate("m51de3320d284")}
                />
              )}
            </section>
          </CardContent>
        </Card>
      </div>
    </PageMessages>
  );
}
