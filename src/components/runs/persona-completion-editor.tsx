"use client";
import { useId, useState } from "react";

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
      setMessage("Saved.");
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : "Could not confirm the save. Reload before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Persona completion</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure the model and shared instructions used by every persona.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={ready ? "default" : "secondary"}>
            {ready ? "Ready" : "Not ready"}
          </Badge>
          {initial.connectionReady && (
            <Badge variant="outline">Connection configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!initial.connectionReady && (
          <p className="mb-4 text-sm text-muted-foreground">
            Set the server completion environment variables to enable a
            connection.
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
              <Label htmlFor={`${prefix}-enabled`}>Enabled</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-model`}>Model ID</Label>
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
                  Temperature (optional)
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
                  Maximum output tokens
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
                Token limit parameter
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
                Shared instructions
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
                Reset to default
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Shared settings apply to future Runs. Each persona supplies its
              own role instructions.
            </p>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-reason`}>
                Change reason (optional)
              </Label>
              <Input
                id={`${prefix}-reason`}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button type="submit">
              {busy ? "Saving…" : "Save completion settings"}
            </Button>
          </fieldset>
          {message && <Notice title={message} />}
        </form>
      </CardContent>
    </Card>
  );
}
