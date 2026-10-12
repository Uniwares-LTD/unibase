"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function ArtifactControls({ id }: { id?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit() {
    setBusy(true);
    try {
      const result = await api(
        id ? `/api/artifacts/${id}` : "/api/artifacts",
        z.object({ id: z.string() }),
        {
          method: "POST",
          body: id ? { action: "delete" } : { id: key, title },
        },
      );
      router.push(id ? "/artifacts" : `/artifacts/${result.id}`);
      router.refresh();
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Could not confirm the request. Reload before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {!id && (
        <>
          <Label htmlFor="artifact-title">Artifact title</Label>
          <Input
            id="artifact-title"
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </>
      )}
      <Button
        variant={id ? "destructive" : "default"}
        disabled={busy || (!id && !title.trim())}
        onClick={() => void submit()}
      >
        {id ? "Delete artifact" : "Create artifact"}
      </Button>
      <p role="status">{message}</p>
    </div>
  );
}
