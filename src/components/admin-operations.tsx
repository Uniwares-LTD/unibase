"use client";
import { useFormatter, useTranslations } from "next-intl";

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
import { Notice } from "./page-patterns";
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

type Message = { tone: "success" | "error"; text: string };

export function AdminCleanup({ defaultDays }: { defaultDays: number }) {
  const translate = useTranslations("ui");
  const common = useTranslations("common");
  const format = useFormatter();

  const router = useRouter();
  const [days, setDays] = useState(String(defaultDays));
  const [limit, setLimit] = useState("50");
  const [scope, setScope] = useState("jobs");
  const [reason, setReason] = useState("");
  const [report, setReport] = useState<CleanupReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  async function run(execute: boolean) {
    setBusy(true);
    setMessage(null);
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
      setMessage({
        tone: "success",
        text: execute
          ? common("cleanupResult", {
              changed: saved.changed,
              skipped: saved.skipped,
              pending: saved.storagePending,
            })
          : translate("m542774327097"),
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : translate("mce7eacc0c6ea"),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p>{translate("m35792baf7fcd")}</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="cleanup-days">{translate("m9615621f3aab")}</Label>
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
          <Label htmlFor="cleanup-limit">{translate("m45d76d00c4e3")}</Label>
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
          <Label htmlFor="cleanup-scope">{translate("m47bd29075f8b")}</Label>
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
              <SelectItem value="jobs">{translate("m927295b89ae4")}</SelectItem>
              <SelectItem value="failed-files">
                {translate("m75f3eb58d023")}
              </SelectItem>
              <SelectItem value="both">{translate("mb6c1d862f9f7")}</SelectItem>

              <SelectItem value="abandoned-uploads">
                {translate("m2b9345e24621")}
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
        {translate("m44dd7c57aa6f")}
      </Button>
      {report && (
        <div className="space-y-3">
          <p>
            {translate("m05e6f6947516", {
              jobs: report.jobs,
              files: report.files,
              abandoned: report.abandonedUploads,
              cutoff: format.dateTime(new Date(report.cutoff), {
                dateStyle: "medium",
              }),
            })}
          </p>

          <p className="text-sm">{translate("mb2926688070e")}</p>
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
            {translate("m6c68ad180780")}
          </Button>
          {report.state === "preview" && (
            <>
              <Label htmlFor="cleanup-reason">
                {translate("mdc2a867b85b6")}
              </Label>
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
                      report.jobs + report.files + report.abandonedUploads === 0
                    }
                  >
                    {translate("m32a06aa8e2b4")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {translate("mad6d7832fb38")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {translate("mb419ef9fb491")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {translate("m19766ed6ccb2")}
                    </AlertDialogCancel>
                    <AlertDialogAction onClick={() => void run(true)}>
                      {translate("m2c456b847520")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      )}
      {message && <Notice tone={message.tone} title={message.text} />}
    </div>
  );
}

export function PaymentReview({ enabled }: { enabled: boolean }) {
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [key, setKey] = useState<string | null>(null);
  async function reconcile() {
    setBusy(true);
    setMessage(null);
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
      setMessage({
        tone: "success",
        text: common("verification", { state: result.state }),
      });
      setKey(null);
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : translate("m8800cc777df4"),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <p>{translate("m6da46287930a")}</p>
      {!enabled && <p>{translate("me00023c11aff")}</p>}
      <Label htmlFor="payment-order">{translate("md89d8487ce82")}</Label>
      <Input
        id="payment-order"
        value={orderId}
        disabled={busy || !enabled}
        onChange={(e) => {
          setOrderId(e.target.value);
          setKey(null);
        }}
      />
      <Label htmlFor="payment-session">{translate("mce0713af4770")}</Label>
      <Input
        id="payment-session"
        value={sessionId}
        disabled={busy || !enabled}
        onChange={(e) => {
          setSessionId(e.target.value);
          setKey(null);
        }}
      />
      <Label htmlFor="payment-reason">{translate("m5b00de00b264")}</Label>
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
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={!enabled || busy || !/^[a-f0-9]{64}$/.test(orderId)}
          >
            {translate("m60f56b618433")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("mb9e55cd63279")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("m1c1fb02fcf3d", { order: orderId.slice(0, 12) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("m19766ed6ccb2")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void reconcile()}>
              {translate("m97d4a98b53c2")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && <Notice tone={message.tone} title={message.text} />}
    </div>
  );
}
