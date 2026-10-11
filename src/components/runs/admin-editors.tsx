"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import type { settingsView } from "@/lib/server/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Json = z.infer<ReturnType<typeof z.json>>;
function errorMessage(e: unknown) {
  return e instanceof ApiError
    ? e.message
    : e instanceof Error
      ? e.message
      : "Could not confirm the request.";
}
const modes: Record<string, string[]> = {
  defaultStyle: ["classic", "glass", "soft-blue"],
  failureCharging: ["success-only", "verified-usage"],
  mode: ["fixed", "tokens", "provider-cost", "hybrid"],
  basis: ["total", "split"],
};
const preset: Record<string, Json> = {
  fixed: { mode: "fixed", credits: 1 },
  tokens: {
    mode: "tokens",
    maxCredits: 10,
    rate: { basis: "total", creditsPerMillion: "1000" },
  },
  "provider-cost": {
    mode: "provider-cost",
    maxCredits: 10,
    currency: "USD",
    creditsPerCurrencyUnit: "100",
  },
  hybrid: {
    mode: "hybrid",
    maxCredits: 10,
    baseCredits: 1,
    usage: {
      mode: "tokens",
      rate: { basis: "total", creditsPerMillion: "1000" },
    },
  },
};
function SettingsField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Json;
  onChange: (value: Json) => void;
}) {
  const id = useId();
  const label = name.replace(/([A-Z])/g, " $1");
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          defaultValue={JSON.stringify(value, null, 2)}
          onBlur={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
              e.target.setCustomValidity("");
            } catch {
              e.target.setCustomValidity("Enter a valid JSON list.");
            }
          }}
        />
        <p className="text-sm text-muted-foreground">
          Credit pack definitions: ID, label, credits, and optional payment
          product references.
        </p>
      </div>
    );
  if (value !== null && typeof value === "object")
    return (
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-2 font-semibold">{label}</legend>
        {Object.entries(value).map(([key, entry]) => (
          <SettingsField
            key={`${key}-${key === "mode" ? String(entry) : ""}`}
            name={key}
            value={entry}
            onChange={(next) => {
              if (
                key === "mode" &&
                typeof next === "string" &&
                name !== "usage"
              )
                onChange(preset[next]);
              else if (key === "mode" && name === "usage")
                onChange(
                  next === "tokens"
                    ? {
                        mode: "tokens",
                        rate: { basis: "total", creditsPerMillion: "1000" },
                      }
                    : {
                        mode: "provider-cost",
                        currency: "USD",
                        creditsPerCurrencyUnit: "100",
                      },
                );
              else if (key === "basis")
                onChange(
                  next === "total"
                    ? { basis: "total", creditsPerMillion: "1000" }
                    : {
                        basis: "split",
                        inputCreditsPerMillion: "1000",
                        outputCreditsPerMillion: "1000",
                      },
                );
              else onChange({ ...value, [key]: next });
            }}
          />
        ))}
      </fieldset>
    );
  return (
    <div className="space-y-2">
      {typeof value === "boolean" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={value}
            onCheckedChange={(v) => onChange(v === true)}
          />
          <Label htmlFor={id}>{label}</Label>
        </div>
      ) : (
        <>
          <Label htmlFor={id}>{label}</Label>
          {modes[name] ? (
            <Select value={String(value)} onValueChange={onChange}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modes[name].map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={id}
              type={typeof value === "number" ? "number" : "text"}
              value={String(value ?? "")}
              onChange={(e) =>
                onChange(
                  typeof value === "number"
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
        </>
      )}
    </div>
  );
}
export function BaseSettingsEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof settingsView>>;
}) {
  const [settings, setSettings] = useState(initial.settings);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/settings", z.unknown(), {
        method: "POST",
        body: { revision: initial.revision, reason, settings },
      });
      setMessage("Settings saved.");
      router.refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <SettingsField
        name="Base settings"
        value={settings}
        onChange={(value) => setSettings(value as typeof settings)}
      />
      <Label htmlFor="settings-reason">Change reason</Label>
      <Input
        id="settings-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={5}
      />
      <Button
        disabled={busy || reason.trim().length < 5}
        onClick={() => void save()}
      >
        Save settings
      </Button>
      <p role="status">{message}</p>
      <Card>
        <CardHeader>
          <CardTitle>Configuration status</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            Dify: {initial.configuration.difyMode} · Management:{" "}
            {initial.configuration.managementConfigured
              ? "configured"
              : "disabled"}{" "}
            · Storage: {initial.configuration.storage} · Payments:{" "}
            {initial.configuration.payments}
          </p>
          <p>
            Credentials and connection settings are configured on the server.
          </p>
        </CardContent>
      </Card>
      <section>
        <h2 className="font-semibold">Revision history</h2>
        <p>Current revision: {initial.revision}</p>
        {initial.history.map((row) => (
          <p key={row.revision}>
            Revision {row.revision} · {row.updatedAt}
          </p>
        ))}
      </section>
    </div>
  );
}
