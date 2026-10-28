"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Notice } from "@/components/page-patterns";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/alert-dialog";
export function ArtifactControls({ id }: { id: string }) {
  const translate = useTranslations("ui");

  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/artifacts/${id}`, z.object({ id: z.string() }), {
        method: "POST",
        body: { action: "delete" },
      });
      router.push("/artifacts");
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : translate("m8b86933c8c92"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={busy}>
            {translate("mc5f3e9c14d36")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{translate("m3f72dfa3a2be")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("medb6a491842a")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("m19766ed6ccb2")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void submit()}
            >
              {translate("mc5f3e9c14d36")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && <Notice tone="error" title={message} />}
    </div>
  );
}
