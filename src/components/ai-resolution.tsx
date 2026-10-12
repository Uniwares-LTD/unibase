"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
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
  const id = useId();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function resolve(decision: "accept" | "release") {
    setBusy(true);
    setMessage("");
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
      setMessage("Resolution recorded.");
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not confirm the resolution. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>Resolution explanation (optional)</Label>
      <Textarea
        id={id}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        disabled={busy}
        placeholder="Record the evidence and reason for this decision."
      />
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button
            disabled={busy}
            onClick={() => {
              void resolve("accept");
            }}
          >
            Accept saved result and settle its calculated charge
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={busy}>
              Resolve attempt and release credits
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Release the user’s credits?</AlertDialogTitle>
              <AlertDialogDescription>
                This records an audited credit waiver. It does not stop a
                provider execution whose state is uncertain; provider costs may
                still accrue. This explicitly resolves the attempt and permits a
                new attempt; it can duplicate work if the provider is still
                running.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep reserved</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void resolve("release");
                }}
              >
                Release credits
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
