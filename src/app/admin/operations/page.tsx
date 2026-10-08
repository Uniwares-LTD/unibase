import Link from "next/link";
import { PageHeader } from "@/components/page-patterns";
import { AdminCleanup, PaymentReview } from "@/components/admin-operations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  operationsSummary,
  cleanupReports,
  paymentOperations,
} from "@/lib/server/operations";
export const metadata = { title: "Operations" };
export default async function OperationsPage() {
  const [summary, reports, payments] = await Promise.all([
    operationsSummary(),
    cleanupReports(),
    paymentOperations(),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Operations"
        description="Worker health, manual recovery and local content cleanup. Mutations require a recent administrator sign-in."
      />
      <Card>
        <CardHeader>
          <CardTitle>Workers and queues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.workers.map((w) => (
            <p key={w.kind}>
              {w.kind} worker: {w.state} · last progress{" "}
              {w.ageSeconds === null ? "not reported" : `${w.ageSeconds}s ago`}
            </p>
          ))}
          <p>
            Active AI executions: {summary.queued} · oldest age:{" "}
            {summary.queueAgeSeconds ?? 0}s · requiring review:{" "}
            {summary.unresolved}
          </p>
          <p>
            Pending payment notifications: {summary.paymentPending} · oldest
            age: {summary.paymentAgeSeconds ?? 0}s
          </p>
          <p className="text-sm">
            A worker is unhealthy after five minutes without progress or a
            failed cycle. Refresh this page for current readings. Queue age
            measures time since submission, including provider execution.
          </p>
          <Link href="/admin/ai" className="underline">
            Review uncertain AI executions
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Manual payment reconciliation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PaymentReview enabled={summary.stripeEnabled} />
          <h3 className="font-semibold">
            Oldest 25 pending or disputed orders
          </h3>
          {!payments.orders.length && <p>No pending or disputed orders.</p>}
          {payments.orders.map((o) => (
            <p className="break-all text-sm" key={o.id}>
              {o.id} · {o.status} · user {o.uid}
            </p>
          ))}
          <h3 className="font-semibold">Latest 20 review attempts</h3>
          {payments.reviews.map((r) => (
            <p className="break-all text-sm" key={r.id}>
              {r.orderId} · {r.state} · {r.createdAt}
            </p>
          ))}
          <p className="text-sm">
            A started attempt without a completion report needs operator review.
            Inspect Stripe and retry verification; never grant credits solely
            from a browser return URL.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Local AI cleanup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <AdminCleanup />
          <h3 className="font-semibold">Latest 20 cleanup reports</h3>
          {reports.map((r) => (
            <p className="break-all text-sm" key={r.id}>
              {r.id} · {r.state} · {r.jobs} executions / {r.files} uploads /{" "}
              {r.abandonedUploads} abandoned uploads · {r.workspaces} archived
              workspaces ({r.workspaceAssets} assets / {r.workspaceEvents}{" "}
              events) · {r.changed} changed or queued / {r.skipped} skipped ·{" "}
              {r.storageDeleted} storage removals complete / {r.storagePending}{" "}
              pending ({r.storageFailed} failed, retry scheduled) ·{" "}
              {r.createdAt}
            </p>
          ))}
          <p className="text-sm">
            Refresh this page to update storage removal reports. If a removal
            keeps failing, check the payment/maintenance worker and private
            storage configuration and permissions. It retries approved removals
            automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
