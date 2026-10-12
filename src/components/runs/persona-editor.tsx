"use client";
import { useId, useState } from "react";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import type { PersonaFields } from "@/lib/contracts/personas";
import type { personasView } from "@/lib/server/runs/personas";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
type View = Awaited<ReturnType<typeof personasView>>;
type Row = View["personas"][number];
function PersonaForm({
  initial,
  responders,
  saved,
  onBusyChange,
}: {
  initial: Row;
  responders: View["responders"];
  saved: (row: Row) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const prefix = useId();
  const [fields, setFields] = useState<PersonaFields>(() => ({
    name: initial.name,
    description: initial.description,
    instructions: initial.instructions,
    responderId: initial.responderId,
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
      setMessage("Saved.");
    } catch (e) {
      setMessage(
        e instanceof ApiError
          ? e.message
          : "Could not confirm the save. Reload before retrying.",
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
              ? "Persona instructions"
              : name === "name"
                ? "Name"
                : "Description"}
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
      <Label htmlFor={`${prefix}-responder`}>Responder workflow</Label>
      <Select
        value={fields.responderId ?? "none"}
        onValueChange={(v) =>
          setFields({ ...fields, responderId: v === "none" ? null : v })
        }
      >
        <SelectTrigger id={`${prefix}-responder`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not configured</SelectItem>
          {responders.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        Create a Persona responder in Orchestrators and configure its model in
        Dify. Only enabled personas with available responders appear on Start
        Run.
      </p>
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
            {name === "enabled" ? "Enabled" : "Archived"}
          </Label>
        </div>
      ))}
      <SettingsField
        name="pricing"
        value={fields.pricing}
        onChange={(pricing) =>
          setFields({
            ...fields,
            pricing: pricing as PersonaFields["pricing"],
          })
        }
      />
      <Label htmlFor={`${prefix}-limit`}>
        Maximum answers per attempt (1–100)
      </Label>
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
      <Label htmlFor={`${prefix}-reason`}>Change reason (optional)</Label>
      <Input
        id={`${prefix}-reason`}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save persona"}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
function newPersona(): Row {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    updatedAt: new Date().toISOString(),
    name: "",
    description: "",
    instructions: "Answer as this persona.",
    responderId: null,
    enabled: false,
    archived: false,
    pricing: { mode: "fixed", credits: 1 },
    maxCalls: 10,
  };
}
function PersonaDialog({
  row,
  responders,
  saved,
}: {
  row?: Row;
  responders: View["responders"];
  saved: (row: Row) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Row>();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) setDraft(row ?? newPersona());
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={row ? "outline" : "default"}>
          {row ? "Edit persona" : "Add persona"}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{row ? `Edit ${row.name}` : "Add persona"}</DialogTitle>
          <DialogDescription>
            Set the persona instructions, responder workflow, pricing and
            limits.
          </DialogDescription>
        </DialogHeader>
        {open && draft && (
          <PersonaForm
            key={draft.id}
            initial={draft}
            responders={responders}
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
  const [rows, setRows] = useState(initial.personas);
  function saved(next: Row) {
    setRows((old) =>
      old.some((row) => row.id === next.id)
        ? old.map((row) => (row.id === next.id ? next : row))
        : [...old, next],
    );
  }
  return (
    <div className="space-y-4">
      <PersonaDialog responders={initial.responders} saved={saved} />
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
                    ? "Archived"
                    : row.enabled
                      ? "Enabled"
                      : "Disabled"}
                </Badge>
                {!row.responderId && (
                  <Badge variant="outline">Responder needed</Badge>
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
                Responder:{" "}
                {initial.responders.find((r) => r.id === row.responderId)
                  ?.name ?? "Not configured"}
              </p>
              <p className="text-sm text-muted-foreground">
                Up to {row.maxCalls} answers per attempt · Revision{" "}
                {row.revision}
              </p>
              <PersonaDialog
                row={row}
                responders={initial.responders}
                saved={saved}
              />
            </CardContent>
          </Card>
        ))}
      </div>
      {!rows.length && (
        <p className="text-sm text-muted-foreground">
          No personas yet. Add one to get started.
        </p>
      )}
    </div>
  );
}
