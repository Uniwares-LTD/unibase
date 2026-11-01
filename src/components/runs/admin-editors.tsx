"use client";
import { DateLabel } from "@/components/localized-value";

import { AdminStateLabel as StateLabel } from "@/components/admin-state-label";

import { adminFieldLabel } from "@/lib/admin-labels";
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
import { Notice } from "@/components/page-patterns";

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
export function SettingsField({
  name,
  value,
  onChange,
  tokenPricingOnly = false,
}: {
  name: string;
  value: Json;
  tokenPricingOnly?: boolean;
  onChange: (value: Json) => void;
}) {
  const id = useId();
  const [invalid, setInvalid] = useState(false);
  const label = adminFieldLabel(name);
  if (Array.isArray(value))
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Textarea
          id={id}
          className="font-mono text-xs"
          defaultValue={JSON.stringify(value, null, 2)}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-help`}
          onChange={(e) => {
            // Validate as the administrator types so a bad list is visible before saving.
            try {
              const parsed: unknown = JSON.parse(e.target.value);
              if (!Array.isArray(parsed)) throw new Error("not a list");
              onChange(parsed as Json);
              e.target.setCustomValidity("");
              setInvalid(false);
            } catch {
              e.target.setCustomValidity("Enter a valid JSON list.");
              setInvalid(true);
            }
          }}
        />
        <p
          id={`${id}-help`}
          className={
            invalid
              ? "text-sm text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {invalid
            ? "Enter a valid JSON list."
            : "Credit pack definitions: ID, label, credits, and optional payment product references."}
        </p>
      </div>
    );
  if (value !== null && typeof value === "object")
    return (
      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-2 font-semibold">{label}</legend>
        {Object.entries(value)
          .filter(
            ([key]) =>
              !(tokenPricingOnly && name === "usage" && key === "mode"),
          )
          .map(([key, entry]) => (
            <SettingsField
              key={`${key}-${key === "mode" ? String(entry) : ""}`}
              name={key}
              tokenPricingOnly={tokenPricingOnly}
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
                {modes[name]
                  .filter(
                    (mode) => !tokenPricingOnly || mode !== "provider-cost",
                  )
                  .map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      <StateLabel value={mode} />
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
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/admin/settings", z.unknown(), {
        method: "POST",
        body: { revision: initial.revision, reason, settings },
      });
      setMessage({ tone: "success", text: "Settings saved." });
      router.refresh();
    } catch (e) {
      setMessage({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <SettingsField
        name="settings"
        value={settings}
        onChange={(value) => setSettings(value as typeof settings)}
      />
      <Label htmlFor="settings-reason">Change reason (optional)</Label>
      <Input
        id="settings-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button disabled={busy} onClick={() => void save()}>
        Save settings
      </Button>
      {message && <Notice tone={message.tone} title={message.text} />}
      <Card>
        <CardHeader>
          <CardTitle>Configuration status</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {(
              [
                ["Dify", initial.configuration.difyMode],
                [
                  "Management",
                  initial.configuration.managementConfigured
                    ? "configured"
                    : "disabled",
                ],
                ["Storage", initial.configuration.storage],
                ["Payments", initial.configuration.payments],
              ] as const
            ).map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>
                  <StateLabel value={value} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            Credentials and connection settings are configured on the server.
          </p>
        </CardContent>
      </Card>
      <section>
        <h2 className="font-semibold">Revision history</h2>
        <p>Current revision: {initial.revision}</p>
        {initial.history.map((row) => (
          <p key={row.revision}>
            Revision {row.revision} · <DateLabel value={row.updatedAt} />
          </p>
        ))}
      </section>
    </div>
  );
}
