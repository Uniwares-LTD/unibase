"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { workspaceSchema, type WorkspaceView } from "@/lib/contracts/workspace";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
type Upload = { file: File; key: string; revision: number };
export function PrivateUpload({
  uid,
  workspaceId,
  revision,
  limit,
  disabled,
  onBusy,
  onSaved,
  onConflict,
}: {
  uid: string;
  workspaceId: string;
  revision: number;
  limit: number;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (next: WorkspaceView) => void;
  onConflict: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Upload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function upload(request: Upload) {
    onBusy(true);
    setError("");
    setNotice("");
    setPending(request);
    const body = new FormData();
    body.set("file", request.file);
    body.set("key", request.key);
    body.set("revision", String(request.revision));
    body.set("expectedUid", uid);
    try {
      const next = await api(
        `/api/workspaces/${workspaceId}/uploads`,
        workspaceSchema,
        { method: "POST", body, timeoutMs: 120_000 },
      );
      onSaved(next);
      setPending(null);
      setNotice("Private image saved.");
    } catch (e) {
      if (
        e instanceof ApiError &&
        ["WORKSPACE_CONFLICT", "ASSET_CONFLICT"].includes(e.code)
      ) {
        setPending(null);
        await onConflict();
      }
      setError(
        e instanceof Error
          ? e.message
          : "Upload interrupted. Retry the same upload.",
      );
    } finally {
      onBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="asset-upload">Upload a private image</Label>
      <p id="asset-upload-help" className="text-sm text-muted-foreground">
        PNG, JPEG or WebP, at most {limit / 1024 / 1024} MiB and 16 million
        pixels. Images are normalized and metadata is removed.
      </p>
      <Input
        id="asset-upload"
        aria-describedby="asset-upload-help"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > limit) {
            setError(`Use an image no larger than ${limit / 1024 / 1024} MiB.`);
            return;
          }
          void upload({ file, key: crypto.randomUUID(), revision });
        }}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {error && pending && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => void upload(pending)}
        >
          Retry this upload
        </Button>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
    </div>
  );
}
