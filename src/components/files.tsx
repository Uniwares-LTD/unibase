"use client";
import { NumberLabel, StateLabel } from "./localized-value";
import { useTranslations } from "next-intl";

import { useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { filePageSchema, privateFileSchema } from "@/lib/contracts/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function Files({
  initial,
}: {
  initial: z.infer<typeof filePageSchema>;
}) {
  const translate = useTranslations("ui");

  const uploadKey = useRef<string | null>(null);
  const [page, setPage] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : translate("me6c5c7ec5c6b"));
    } finally {
      setBusy(false);
    }
  }
  const refresh = async (cursor?: string) =>
    setPage(
      await api(
        "/api/files" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
        filePageSchema,
      ),
    );
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{translate("mabc7e9892806")}</h1>
      <p>
        <NumberLabel value={page.usage.count} /> {translate("mb5c9ca254658")}{" "}
        <NumberLabel value={page.usage.bytes} />{" "}
        {translate("me12bef0ba4b5")}{" "}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set(
            "key",
            uploadKey.current ?? (uploadKey.current = crypto.randomUUID()),
          );
          void perform(async () => {
            await api("/api/files", privateFileSchema, {
              method: "POST",
              body: form,
              timeoutMs: 60000,
            });
            uploadKey.current = null;
            await refresh();
          });
        }}
        className="space-y-3"
      >
        <Label htmlFor="private-file">{translate("m6d684ec42aa9")}</Label>
        <Input
          id="private-file"
          name="file"
          type="file"
          onChange={() => {
            uploadKey.current = null;
          }}
          required
          disabled={busy}
          accept=".txt,.pdf,.png,.jpg,.jpeg,.webp,.mp3,.wav,.mp4"
        />
        <Button disabled={busy}>{translate("m865e89de78d9")}</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-3">
        {page.rows.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center gap-3 rounded border p-3"
          >
            <span className="min-w-0 flex-1 break-words">
              {file.name} · <NumberLabel value={file.bytes} />{" "}
              {translate("m9ec239356ce9")} <StateLabel value={file.state} />
            </span>
            {file.state === "ready" && (
              <Button asChild variant="outline">
                <a href={`/api/files/${file.id}/content`} download>
                  {translate("md6eafe823591")}{" "}
                </a>
              </Button>
            )}
            <Button
              disabled={busy || file.state !== "ready"}
              variant="outline"
              onClick={() =>
                void perform(async () => {
                  await api(
                    `/api/files/${file.id}`,
                    z.object({ ok: z.boolean() }),
                    { method: "DELETE" },
                  );
                  uploadKey.current = null;
                  await refresh();
                })
              }
            >
              {translate("me2d0a54968ea")}{" "}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void perform(() => refresh())}
        >
          {translate("m2eb0f90947f6")}{" "}
        </Button>
        {page.next && (
          <Button
            disabled={busy}
            onClick={() => void perform(() => refresh(page.next!))}
          >
            {translate("mf4df99a92042")}{" "}
          </Button>
        )}
      </div>
    </section>
  );
}
