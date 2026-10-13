"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { filePageSchema } from "@/lib/contracts/files";
import { Button } from "./ui/button";
export function ManagedFilePicker({
  orchestratorId,
  disabled,
  onSelected,
  onBusy,
}: {
  orchestratorId: string;
  disabled: boolean;
  onSelected: (id: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const translate = useTranslations("ui");

  const [page, setPage] = useState<z.infer<typeof filePageSchema> | null>(null),
    [error, setError] = useState("");
  async function perform(action: () => Promise<void>) {
    setError("");
    onBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : translate("m815093565b74"));
    } finally {
      onBusy(false);
    }
  }
  async function load(cursor?: string) {
    setPage(
      await api(
        "/api/files" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
        filePageSchema,
      ),
    );
  }
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => void perform(() => load())}
      >
        {translate("ma2e6f1584f09")}{" "}
      </Button>
      {page && (
        <ul className="space-y-2">
          {page.rows
            .filter((f) => f.state === "ready")
            .map((f) => (
              <li key={f.id}>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    void perform(async () => {
                      const value = await api(
                        "/api/run-uploads",
                        z.object({ id: z.string(), status: z.string() }),
                        {
                          method: "POST",
                          body: { orchestratorId, fileId: f.id },
                          timeoutMs: 60000,
                        },
                      );
                      if (value.status !== "ready")
                        throw new Error(translate("m1635b7292b1a"));
                      onSelected(value.id);
                      setPage(null);
                    })
                  }
                >
                  {f.name}
                </Button>
              </li>
            ))}
          {page.next && (
            <li>
              <Button
                type="button"
                disabled={disabled}
                onClick={() => void perform(() => load(page.next!))}
              >
                {translate("m59413092d39d")}{" "}
              </Button>
            </li>
          )}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
