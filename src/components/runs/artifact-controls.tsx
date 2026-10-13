"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
export function ArtifactControls({ id }: { id: string }) {
  const translate = useTranslations("ui");

  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit() {
    setBusy(true);
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
    <div className="space-y-2">
      <Button
        variant="destructive"
        disabled={busy}
        onClick={() => void submit()}
      >
        {translate("mc5f3e9c14d36")}{" "}
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
