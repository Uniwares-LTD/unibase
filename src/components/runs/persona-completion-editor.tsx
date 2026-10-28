"use client";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Notice } from "@/components/page-patterns";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import {
  defaultCompletionInstructions,
  type PersonaCompletionSettings,
} from "@/lib/contracts/personas";
import type { personaCompletionView } from "@/lib/server/runs/persona-completion-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type View = Awaited<ReturnType<typeof personaCompletionView>>;
export function CompletionEditor({
  initial,
  onReady,
}: {
  initial: View;
  onReady: (ready: boolean) => void;
}) {
  const translate = useTranslations("ui");
  const prefix = useId();
  const [settings, setSettings] = useState<PersonaCompletionSettings>(
    initial.settings,
  );
  const [revision, setRevision] = useState(initial.revision);
  const [ready, setReady] = useState(initial.ready);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await api(
        "/api/admin/personas/completion",
        z.object({ revision: z.number() }),
        { method: "POST", body: { revision, settings, reason } },
      );
      setRevision(next.revision);
      const available =
        initial.connectionReady && settings.enabled && !!settings.model;
      setReady(available);
      onReady(available);
      setMessage(translate("mfca046ccd586"));
    } catch (error) {
      setMessage(
        error instanceof ApiError ? error.message : translate("m47715ac03001"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("m9de0877167bc")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {translate("m812dd5feea1f")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={ready ? "default" : "secondary"}>
            {ready ? translate("m5fa7aac5375c") : translate("m330010f40240")}
          </Badge>
          {initial.connectionReady && (
            <Badge variant="outline">{translate("m4fd1710a736c")}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!initial.connectionReady && (
          <p className="mb-4 text-sm text-muted-foreground">
            {translate("m96aedb4532ab")}
          </p>
        )}
        <form className="space-y-4" onSubmit={save}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${prefix}-enabled`}
                checked={settings.enabled}
                onCheckedChange={(v) =>
                  setSettings({ ...settings, enabled: v === true })
                }
              />
              <Label htmlFor={`${prefix}-enabled`}>
                {translate("m92c1cdfdf4cb")}
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-model`}>
                {translate("m089ef2b6dbb3")}
              </Label>
              <Input
                id={`${prefix}-model`}
                value={settings.model}
                required={settings.enabled}
                maxLength={200}
                onChange={(e) =>
                  setSettings({ ...settings, model: e.target.value })
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-temperature`}>
                  {translate("me1a4077b26af")}
                </Label>
                <Input
                  id={`${prefix}-temperature`}
                  type="number"
                  min={0}
                  max={2}
                  step="0.1"
                  value={settings.temperature ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      temperature:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-tokens`}>
                  {translate("m28b2aeb30c06")}
                </Label>
                <Input
                  id={`${prefix}-tokens`}
                  required
                  type="number"
                  min={1}
                  max={32768}
                  value={settings.maxOutputTokens}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxOutputTokens: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-parameter`}>
                {translate("me4bd0748fb49")}
              </Label>
              <Select
                value={settings.tokenParameter}
                onValueChange={(v) =>
                  setSettings({
                    ...settings,
                    tokenParameter:
                      v as PersonaCompletionSettings["tokenParameter"],
                  })
                }
              >
                <SelectTrigger id={`${prefix}-parameter`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="max_completion_tokens">
                    max_completion_tokens
                  </SelectItem>
                  <SelectItem value="max_tokens">max_tokens</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-instructions`}>
                {translate("m71e1b0b067f6")}
              </Label>
              <Textarea
                id={`${prefix}-instructions`}
                required
                maxLength={8000}
                rows={5}
                value={settings.instructions}
                onChange={(e) =>
                  setSettings({ ...settings, instructions: e.target.value })
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setSettings({
                    ...settings,
                    instructions: defaultCompletionInstructions,
                  })
                }
              >
                {translate("mbc5b45ae7b60")}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {translate("m299efc821572")}
            </p>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-reason`}>
                {translate("mfcbdbd5d879b")}
              </Label>
              <Input
                id={`${prefix}-reason`}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button type="submit">
              {busy ? translate("m23e39291d613") : translate("md599b2bbf718")}
            </Button>
          </fieldset>
          {message && <Notice title={message} />}
        </form>
      </CardContent>
    </Card>
  );
}
