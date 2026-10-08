"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import {
  cleanupReportSchema,
  type CleanupReportView,
} from "@/lib/contracts/operations";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

export function AdminCleanup() {
  const router = useRouter();
  const [days, setDays] = useState("30");
  const [limit, setLimit] = useState("50");
  const [scope, setScope] = useState("jobs");
  const [reason, setReason] = useState("");
  const [report, setReport] = useState<CleanupReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(execute: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const saved = await api(
        `/api/admin/operations/cleanup/${execute ? "execute" : "preview"}`,
        cleanupReportSchema,
        {
          method: "POST",
          timeoutMs: 120000,
          body: execute
            ? { reportId: report!.id, confirm: true, reason }
            : { olderThanDays: Number(days), scope, limit: Number(limit) },
        },
      );
      setReport(saved);
      router.refresh();
      setMessage(
        execute
          ? `Cleanup approved: ${saved.changed} changed or queued, ${saved.skipped} skipped after rechecking eligibility. ${saved.storagePending} storage removals pending. Refresh reports for completion.`
          : "Preview ready. Nothing has been removed. Preview expires in 15 minutes.",
      );
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not confirm the operation. Refresh reports before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p>
        Remove local prompts/results from old terminal executions, or reclaim
        the local quota of failed uploads, or remove abandoned application-owned
        private uploads. Active and uncertain executions are excluded. Provider
        files, billing, usage, audit and retry records remain.
      </p>
      <p>
        Archived workspace cleanup permanently removes saved content,
        conversations and private assets. Finish or cancel workflow runs before
        archiving. Active or unresolved jobs and uploads prevent deletion. This
        scope previews at most 10 eligible workspaces from the oldest 100
        archived candidates.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="cleanup-days">Older than (days)</Label>
          <Input
            id="cleanup-days"
            type="number"
            min={1}
            max={3650}
            value={days}
            disabled={busy}
            onChange={(e) => {
              setDays(e.target.value);
              setReport(null);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cleanup-limit">Maximum records</Label>
          <Input
            id="cleanup-limit"
            type="number"
            min={1}
            max={100}
            value={limit}
            disabled={busy}
            onChange={(e) => {
              setLimit(e.target.value);
              setReport(null);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cleanup-scope">Content</Label>
          <Select
            value={scope}
            disabled={busy}
            onValueChange={(v) => {
              setScope(v);
              setReport(null);
            }}
          >
            <SelectTrigger id="cleanup-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="jobs">Completed AI content</SelectItem>
              <SelectItem value="failed-files">
                Failed upload references
              </SelectItem>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="archived-workspaces">
                Archived workspaces and content
              </SelectItem>
              <SelectItem value="abandoned-uploads">
                Abandoned private uploads
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        disabled={
          busy ||
          !Number.isInteger(Number(days)) ||
          Number(days) < 1 ||
          Number(days) > 3650 ||
          !Number.isInteger(Number(limit)) ||
          Number(limit) < 1 ||
          Number(limit) > 100
        }
        onClick={() => void run(false)}
      >
        Preview cleanup
      </Button>
      {report && (
        <div className="space-y-3">
          <p>
            {report.jobs} executions · {report.files} failed uploads ·{" "}
            {report.abandonedUploads} abandoned private uploads · cutoff{" "}
            {report.cutoff.slice(0, 10)} UTC
          </p>
          {report.workspaces > 0 && (
            <p>
              {report.workspaces} archived workspaces · {report.workspaceAssets}{" "}
              saved assets · {report.workspaceEvents} conversation events. All
              versions, decisions, reviews and workflow content in these
              workspaces will be removed.
            </p>
          )}
          <p className="text-sm">
            This is one bounded batch. Generate another preview for remaining
            eligible content. Changed records are skipped rather than replaced
            with new targets.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(report, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `cleanup-${report.id}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download report
          </Button>
          {report.state === "preview" && (
            <>
              <Label htmlFor="cleanup-reason">Cleanup explanation</Label>
              <Textarea
                id="cleanup-reason"
                value={reason}
                maxLength={500}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={
                      busy ||
                      reason.trim().length < 10 ||
                      report.jobs +
                        report.files +
                        report.abandonedUploads +
                        report.workspaces ===
                        0
                    }
                  >
                    Execute previewed cleanup
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Remove the previewed local content?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This cannot be undone here. Only the IDs in this preview
                      are considered. Billing and audit records remain, and
                      AI-provider files are not deleted. Approved abandoned
                      private uploads are removed from application storage by
                      the maintenance worker. Archived workspace cleanup removes
                      all saved workspace content and queues its private objects
                      for removal.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void run(true)}>
                      Confirm cleanup
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export function PaymentReview({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [key, setKey] = useState<string | null>(null);
  async function reconcile() {
    setBusy(true);
    setMessage("");
    const requestKey = key ?? crypto.randomUUID();
    setKey(requestKey);
    try {
      const result = await api(
        "/api/admin/operations/payments",
        z.object({ state: z.string() }),
        {
          method: "POST",
          timeoutMs: 120000,
          body: {
            key: requestKey,
            orderId,
            reason,
            ...(sessionId ? { sessionId } : {}),
          },
        },
      );
      setMessage(
        `Verification: ${result.state}. Review the order and provider evidence before another attempt.`,
      );
      setKey(null);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Outcome uncertain. Retry unchanged fields to retrieve this attempt's report.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p>
        Recheck an existing order against Stripe. Verified payments, refunds and
        disputes update credits through the existing ledger. This does not issue
        a refund or invent a payment outcome.
      </p>
      {!enabled && (
        <p>Stripe reconciliation is disabled in this environment.</p>
      )}
      <Label htmlFor="payment-order">Order ID</Label>
      <Input
        id="payment-order"
        value={orderId}
        disabled={busy || !enabled}
        onChange={(e) => {
          setOrderId(e.target.value);
          setKey(null);
        }}
      />
      <Label htmlFor="payment-session">
        Verified Checkout session ID (optional recovery)
      </Label>
      <Input
        id="payment-session"
        value={sessionId}
        disabled={busy || !enabled}
        onChange={(e) => {
          setSessionId(e.target.value);
          setKey(null);
        }}
      />
      <Label htmlFor="payment-reason">Review explanation</Label>
      <Textarea
        id="payment-reason"
        value={reason}
        maxLength={500}
        disabled={busy || !enabled}
        onChange={(e) => {
          setReason(e.target.value);
          setKey(null);
        }}
      />
      <Button
        disabled={
          !enabled ||
          busy ||
          !/^[a-f0-9]{64}$/.test(orderId) ||
          reason.trim().length < 10
        }
        onClick={() => void reconcile()}
      >
        Verify payment and reconcile credits
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
