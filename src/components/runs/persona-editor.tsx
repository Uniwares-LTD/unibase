"use client";
import { useTranslations } from "next-intl";
import { EmptyState, Notice } from "@/components/page-patterns";

import { useId, useState } from "react";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import type { PersonaFields } from "@/lib/contracts/personas";
import type { personasView } from "@/lib/server/runs/personas";
import { CompletionEditor } from "./persona-completion-editor";
import { SettingsField } from "./admin-editors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
type View = Awaited<ReturnType<typeof personasView>>;
type Row = View["personas"][number];
function PersonaForm({
  initial,
  saved,
  onBusyChange,
}: {
  initial: Row;
  saved: (row: Row) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const translate = useTranslations("ui");

  const prefix = useId();
  const [fields, setFields] = useState<PersonaFields>(() => ({
    name: initial.name,
    description: initial.description,
    instructions: initial.instructions,
    enabled: initial.enabled,
    archived: initial.archived,
    pricing: initial.pricing,
    maxCalls: initial.maxCalls,
  }));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    try {
      await api("/api/admin/personas", z.object({ id: z.string() }), {
        method: "POST",
        body: { id: initial.id, revision: initial.revision, fields, reason },
      });
      saved({
        ...initial,
        ...fields,
        revision: initial.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      setMessage(translate("mfca046ccd586"));
    } catch (e) {
      setMessage(
        e instanceof ApiError ? e.message : translate("m47715ac03001"),
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save();
      }}
    >
      {(["name", "description", "instructions"] as const).map((name) => (
        <div className="space-y-2" key={name}>
          <Label htmlFor={`${prefix}-${name}`}>
            {name === "instructions"
              ? translate("m5935c69b327c")
              : name === "name"
                ? translate("mdcd1d5223f73")
                : translate("m526e0087cc3f")}
          </Label>
          {name === "name" ? (
            <Input
              id={`${prefix}-${name}`}
              maxLength={100}
              required
              value={fields[name]}
              onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
            />
          ) : (
            <Textarea
              id={`${prefix}-${name}`}
              maxLength={name === "instructions" ? 3000 : 500}
              required={name === "instructions"}
              value={fields[name]}
              onChange={(e) => setFields({ ...fields, [name]: e.target.value })}
            />
          )}
        </div>
      ))}
      {(["enabled", "archived"] as const).map((name) => (
        <div className="flex items-center gap-2" key={name}>
          <Checkbox
            id={`${prefix}-${name}`}
            checked={fields[name]}
            onCheckedChange={(v) =>
              setFields({ ...fields, [name]: v === true })
            }
          />
          <Label htmlFor={`${prefix}-${name}`}>
            {name === "enabled"
              ? translate("m92c1cdfdf4cb")
              : translate("mbdb86505f806")}
          </Label>
        </div>
      ))}
      <SettingsField
        name="pricing"
        tokenPricingOnly
        value={fields.pricing}
        onChange={(pricing) =>
          setFields({
            ...fields,
            pricing: pricing as PersonaFields["pricing"],
          })
        }
      />
      <Label htmlFor={`${prefix}-limit`}>{translate("md834d30f922a")}</Label>
      <Input
        id={`${prefix}-limit`}
        type="number"
        min={1}
        max={100}
        value={fields.maxCalls}
        onChange={(e) =>
          setFields({ ...fields, maxCalls: Number(e.target.value) })
        }
      />
      <Label htmlFor={`${prefix}-reason`}>{translate("mfcbdbd5d879b")}</Label>
      <Input
        id={`${prefix}-reason`}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" disabled={busy}>
        {busy ? translate("m23e39291d613") : translate("mcc7e25dfff58")}
      </Button>
      {message && <Notice title={message} />}
    </form>
  );
}
function newPersona(instructions: string): Row {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    updatedAt: new Date().toISOString(),
    name: "",
    description: "",
    instructions,
    enabled: false,
    archived: false,
    pricing: { mode: "fixed", credits: 1 },
    maxCalls: 10,
  };
}
function PersonaDialog({
  row,
  saved,
}: {
  row?: Row;
  saved: (row: Row) => void;
}) {
  const translate = useTranslations("ui");

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Row>();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setDraft(row ?? newPersona(translate("mb18a23ed8e48")));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={row ? "outline" : "default"}>
          {row ? translate("m8bedc53465b0") : translate("mcef5da764d9e")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {row ? `Edit ${row.name}` : translate("mcef5da764d9e")}
          </DialogTitle>
          <DialogDescription>{translate("m06bc719f9219")}</DialogDescription>
        </DialogHeader>
        {open && draft && (
          <PersonaForm
            key={draft.id}
            initial={draft}
            onBusyChange={setBusy}
            saved={(next) => {
              saved(next);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
export function PersonaEditor({ initial }: { initial: View }) {
  const translate = useTranslations("ui");

  const [rows, setRows] = useState(initial.personas);
  const [completionReady, setCompletionReady] = useState(
    initial.completion.ready,
  );
  function saved(next: Row) {
    setRows((old) =>
      old.some((row) => row.id === next.id)
        ? old.map((row) => (row.id === next.id ? next : row))
        : [...old, next],
    );
  }
  return (
    <div className="space-y-4">
      <CompletionEditor
        initial={initial.completion}
        onReady={setCompletionReady}
      />
      <PersonaDialog saved={saved} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="break-words">{row.name}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    row.enabled && !row.archived ? "default" : "secondary"
                  }
                >
                  {row.archived
                    ? translate("mbdb86505f806")
                    : row.enabled
                      ? translate("m92c1cdfdf4cb")
                      : translate("m75081b593d15")}
                </Badge>
                {!completionReady && (
                  <Badge variant="outline">{translate("m0b8cf6e153eb")}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.description && (
                <p className="text-sm text-muted-foreground break-words">
                  {row.description}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                {row.instructions}
              </p>
              <p className="text-sm text-muted-foreground">
                {translate("m9bbe22c13579", {
                  count: row.maxCalls,
                  revision: row.revision,
                })}
              </p>
              <PersonaDialog row={row} saved={saved} />
            </CardContent>
          </Card>
        ))}
      </div>
      {!rows.length && (
        <EmptyState
          title={translate("m130a7da2c155")}
          description={translate("mc4ae5877e276")}
        />
      )}
    </div>
  );
}
