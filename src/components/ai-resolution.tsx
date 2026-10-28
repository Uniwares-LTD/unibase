"use client";
import { useTranslations } from "next-intl";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Notice } from "./page-patterns";
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

export function AiResolution({
  jobId,
  canAccept,
}: {
  jobId: string;
  canAccept: boolean;
}) {
  const translate = useTranslations("ui");

  const id = useId();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  async function resolve(decision: "accept" | "release") {
    setBusy(true);
    setMessage(null);
    try {
      await api(
        `/api/admin/ai/jobs/${jobId}/resolve`,
        z.object({ resolved: z.literal(true) }),
        {
          method: "POST",
          body: { decision, reason, acknowledgeProviderMayStillRun: true },
        },
      );
      router.refresh();
      setMessage({ tone: "success", text: translate("m157fea7c0bc1") });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof ApiError
            ? error.message
            : translate("m2371ba76283f"),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>{translate("m777b71247907")}</Label>
      <Textarea
        id={id}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        disabled={busy}
        placeholder={translate("mc69dce41d50b")}
      />
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={busy}>{translate("me404048f0463")}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {translate("m54134a56ccdb")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {translate("m54f5ae56a858")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {translate("md0d1f332872a")}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void resolve("accept");
                  }}
                >
                  {translate("m5f1832b2b9b3")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={busy}>
              {translate("m2f4de33927e0")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{translate("m25929b7a63f6")}</AlertDialogTitle>
              <AlertDialogDescription>
                {translate("m9f8a061314b8")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {translate("md0d1f332872a")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void resolve("release");
                }}
              >
                {translate("m068930c9fe98")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {message && <Notice tone={message.tone} title={message.text} />}
    </div>
  );
}
