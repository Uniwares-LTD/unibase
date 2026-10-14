"use client";
import { DateLabel } from "@/components/localized-value";

import { StateLabel } from "@/components/localized-value";
import { useTranslations } from "next-intl";

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
function errorMessage(
  e: unknown,
  translate: ReturnType<typeof useTranslations<"ui">>,
) {
  return e instanceof ApiError
    ? e.message
    : e instanceof Error
      ? e.message
      : translate("me0dcb8fe5e54");
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
  const translate = useTranslations("ui");

  const id = useId();
  const fields = useTranslations("fields");
  const label = fields.has(name as never) ? fields(name as never) : name;
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
              e.target.setCustomValidity(translate("m6b761165184a"));
            }
          }}
        />
        <p className="text-sm text-muted-foreground">
          {translate("md3d289611706")}{" "}
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
  const translate = useTranslations("ui");

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
      setMessage(translate("mae493e21cd43"));
      router.refresh();
    } catch (e) {
      setMessage(errorMessage(e, translate));
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
      <Label htmlFor="settings-reason">{translate("mfcbdbd5d879b")}</Label>
      <Input
        id="settings-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button disabled={busy} onClick={() => void save()}>
        {translate("m7f3a3b142814")}{" "}
      </Button>
      <p role="status">{message}</p>
      <Card>
        <CardHeader>
          <CardTitle>{translate("m580e5a99ca05")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            {translate("m7c0005e0f339")} {initial.configuration.difyMode}{" "}
            {translate("mde102711acfa")}{" "}
            {initial.configuration.managementConfigured
              ? "configured"
              : "disabled"}{" "}
            {translate("mbb0c41ff1192")} {initial.configuration.storage}{" "}
            {translate("m352a594e91f2")} {initial.configuration.payments}
          </p>
          <p>{translate("m32e4874ab38a")} </p>
        </CardContent>
      </Card>
      <section>
        <h2 className="font-semibold">{translate("m5ae0d3d186c7")}</h2>
        <p>
          {translate("mad84843ce0c9")} {initial.revision}
        </p>
        {initial.history.map((row) => (
          <p key={row.revision}>
            {translate("m2e516d68f42f")} {row.revision} ·{" "}
            <DateLabel value={row.updatedAt} />
          </p>
        ))}
      </section>
    </div>
  );
}
