"use client";

import { useEffect, useId, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { api } from "@/lib/client/api";
import {
  workflowVersionsSchema,
  type WorkflowVersionSelection,
  type WorkflowVersions,
} from "@/lib/contracts/workflow-versions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function WorkflowVersionPicker({
  appId,
  currentWorkflowId,
  label,
  disabled,
  onRegister,
  copy = false,
}: {
  appId: string;
  currentWorkflowId?: string;
  label: string;
  disabled: boolean;
  onRegister: (selection?: WorkflowVersionSelection) => void;
  copy?: boolean;
}) {
  const t = useTranslations("ui");
  const format = useFormatter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [versions, setVersions] = useState<
    (WorkflowVersions["versions"][number] & { page: number })[]
  >([]);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await api(
          "/api/admin/orchestrators/manage",
          workflowVersionsSchema,
          {
            method: "POST",
            body: { action: "versions", appId, page },
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setVersions((prior) => [
          ...prior.filter(
            (row) => !result.versions.some((item) => item.id === row.id),
          ),
          ...result.versions.map((row) => ({ ...row, page: result.page })),
        ]);
        setHasMore(result.hasMore);
        if (result.versions.some((row) => row.id === currentWorkflowId))
          setSelected((prior) => prior || currentWorkflowId!);
      } catch {
        if (!controller.signal.aborted) setError(t("m812bc445e642"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, appId, page, currentWorkflowId, t]);
  const chosen = versions.find((row) => row.id === selected);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setVersions([]);
          setSelected("");
          setPage(1);
          setHasMore(false);
          setError("");
          setLoading(true);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>{label}</Button>
      </DialogTrigger>
      <DialogContent className="rtl:translate-x-1/2">
        <DialogHeader>
          <DialogTitle>{t("m00e8b2d8315a")}</DialogTitle>
          <DialogDescription>{t("m10a987df15bf")}</DialogDescription>
        </DialogHeader>
        {currentWorkflowId && (
          <p className="break-all text-sm">
            {t("m2db0073126bf", { id: currentWorkflowId })}
          </p>
        )}
        <Label htmlFor={id}>{t("m02b2218fdf03")}</Label>
        <Select value={selected} onValueChange={setSelected} disabled={loading}>
          <SelectTrigger id={id} className="w-full min-w-0">
            <SelectValue placeholder={t("m549618280324")} />
          </SelectTrigger>
          <SelectContent>
            {!copy && (
              <SelectItem value="draft">{t("m10f515d80f01")}</SelectItem>
            )}
            {versions.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name ||
                  (row.number == null ? row.version : `#${row.number}`)}{" "}
                ·{" "}
                {format.dateTime(new Date(row.createdAt * 1000), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · {row.id.slice(0, 8)}
                {row.id === currentWorkflowId ? ` · ${t("m9ce08f625aa4")}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected === "draft" && (
          <p className="text-sm text-muted-foreground">{t("mb6247af24de8")}</p>
        )}
        {chosen && <p className="break-all text-sm">{chosen.id}</p>}
        {loading && <p role="status">{t("m8244e1ce0d56")}</p>}
        {error && <p role="alert">{error}</p>}
        {error ? (
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t("m641365d3fb4d")}
          </Button>
        ) : (
          hasMore && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("m6b3446e28837")}
            </Button>
          )
        )}
        <DialogFooter>
          <Button
            disabled={disabled || loading || (selected !== "draft" && !chosen)}
            onClick={() => {
              setOpen(false);
              onRegister(
                chosen
                  ? { workflowId: chosen.id, page: chosen.page }
                  : undefined,
              );
            }}
          >
            {copy ? t("m0e0000000001") : t("m34c988995ae9")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
