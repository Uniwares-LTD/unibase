import { StateLabel, DateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader } from "@/components/page-patterns";
import { AdminCleanup, PaymentReview } from "@/components/admin-operations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  const { settings } = await readSettings();
  const [summary, reports, payments] = await Promise.all([
    operationsSummary(),
    cleanupReports(),
    paymentOperations(),
  ]);
  return (
    <PageMessages path="/admin/operations">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m358cc201f87d")}
            description={translate("mf42e7a16fa5e")}
          />
          <Card>
            <CardHeader>
              <CardTitle>{translate("m5fb09750c87b")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.workers.map((w) => (
                <p key={w.kind}>
                  {w.kind} {translate("m414a74b5b1a7")}{" "}
                  <StateLabel value={w.state} /> {translate("m53783ad52772")}{" "}
                  {w.ageSeconds === null
                    ? "not reported"
                    : `${w.ageSeconds}s ago`}
                </p>
              ))}
              <p>
                {translate("m6b26c1f5ba57")} {summary.queued}{" "}
                {translate("m8547e617d4c5")} {summary.queueAgeSeconds ?? 0}
                {translate("m6ce1dabceff8")} {summary.unresolved}
              </p>
              <p>
                {translate("m46233779a57a")} {summary.paymentPending}{" "}
                {translate("m8547e617d4c5")} {summary.paymentAgeSeconds ?? 0}
                {translate("m043a718774c5")}{" "}
              </p>
              <p className="text-sm">{translate("m342c457b5f7c")} </p>
              <Link href="/admin/ai" className="underline">
                {translate("mdb59f8979df7")}{" "}
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{translate("mc9e1264f5def")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PaymentReview enabled={summary.stripeEnabled} />
              <h3 className="font-semibold">{translate("mc77db1086fac")} </h3>
              {!payments.orders.length && <p>{translate("m81d429e85210")}</p>}
              {payments.orders.map((o) => (
                <p className="break-all text-sm" key={o.id}>
                  {o.id} · <StateLabel value={o.status} />{" "}
                  {translate("m8f2894f3bea5")} <bdi>{o.uid}</bdi>
                </p>
              ))}
              <h3 className="font-semibold">{translate("m5552a9df200b")}</h3>
              {payments.reviews.map((r) => (
                <p className="break-all text-sm" key={r.id}>
                  {r.orderId} · <StateLabel value={r.state} /> ·{" "}
                  <DateLabel value={r.createdAt} />
                </p>
              ))}
              <p className="text-sm">{translate("me5a3391be2de")} </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{translate("m00210238862e")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <AdminCleanup defaultDays={settings.runs.cleanupDays} />
              <h3 className="font-semibold">{translate("m0aabfed81c23")}</h3>
              {reports.map((r) => (
                <p className="break-all text-sm" key={r.id}>
                  {r.id} · <StateLabel value={r.state} /> · {r.jobs}{" "}
                  {translate("ma66ffc5cbbd9")} {r.files}{" "}
                  {translate("m53911e251671")} {r.abandonedUploads}{" "}
                  {translate("m2af7693c9670")} {r.changed}{" "}
                  {translate("me5d38a52039e")} {r.skipped}{" "}
                  {translate("m546ab943047e")} {r.storageDeleted}{" "}
                  {translate("m3d691d2e3bec")} {r.storagePending}{" "}
                  {translate("m3b6fcc1b50d5")}
                  {r.storageFailed} {translate("m826857adbfb7")}{" "}
                  <DateLabel value={r.createdAt} />
                </p>
              ))}
              <p className="text-sm">{translate("m3e5cf61fe610")} </p>
            </CardContent>
          </Card>
        </div>
      }
    </PageMessages>
  );
}
