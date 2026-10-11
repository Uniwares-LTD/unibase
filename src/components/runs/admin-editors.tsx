"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import type { settingsView } from "@/lib/server/settings";
import type { orchestrators } from "@/lib/server/runs/orchestrators";
import {
  orchestratorSchema,
  type OrchestratorDefinition,
} from "@/lib/contracts/runs";
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
const empty: OrchestratorDefinition = {
  id: "new-orchestrator",
  name: "New orchestrator",
  description: "",
  order: 0,
  keyEnv: "DIFY_KEY_NEW",
  enabled: false,
  inputs: [],
  pricing: null,
  recovery: null,
};
export function OrchestratorEditor({
  initial,
}: {
  initial: Awaited<ReturnType<typeof orchestrators>>;
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState<OrchestratorDefinition>(empty);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<
    { id: string; name: string; mode: string; description?: string }[]
  >([]);
  const [yaml, setYaml] = useState("");
  const [target, setTarget] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [importId, setImportId] = useState("");
  const [importKey, setImportKey] = useState(() => crypto.randomUUID());
  async function manage(body: unknown) {
    setBusy(true);
    try {
      const result = await api("/api/admin/orchestrators/manage", z.unknown(), {
        method: "POST",
        body,
        timeoutMs: 60000,
      });
      setMessage("Request completed.");
      return result;
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const [contractErrors, setContractErrors] = useState<string[]>([]);
  async function save(validate: boolean) {
    if (contractErrors.length) {
      setMessage("Correct the JSON contract fields before saving.");
      return;
    }
    setBusy(true);
    try {
      const path = validate
        ? "/api/admin/orchestrators/manage"
        : "/api/admin/orchestrators";
      await api(path, z.unknown(), {
        method: "POST",
        body: {
          ...(validate ? { action: "validate" } : {}),
          definition,
          revision,
          reason,
        },
        timeoutMs: 60000,
      });
      setRevision(revision + 1);
      setMessage("Orchestrator saved.");
      router.refresh();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function load(row: (typeof initial)[number]) {
    setDefinition(
      orchestratorSchema.parse(
        Object.fromEntries(
          Object.entries(row).filter(
            ([key]) => key in orchestratorSchema.shape,
          ),
        ),
      ),
    );
    setRevision("revision" in row ? row.revision : 0);
    setContractErrors([]);
  }
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Registered orchestrators</h2>
        <p>
          When management is disabled or denied, import these templates in Dify
          and register the published app with an execution key reference.
        </p>
        <nav
          aria-label="DSL template downloads"
          className="flex flex-wrap gap-3"
        >
          {[
            "generation",
            "decision",
            "mcp",
            "failure",
            "recovery",
            "image",
            "child",
          ].map((name) => (
            <a
              key={name}
              href={`/api/admin/orchestrators/templates/${name}`}
              className="underline"
            >
              {name} DSL
            </a>
          ))}
        </nav>
        {initial.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <p>
              {row.name} ·{" "}
              {"enabled" in row && row.enabled ? "selectable" : "disabled"} ·{" "}
              {row.ready ? "configured" : "missing credentials/version"}
            </p>
            <Button variant="outline" onClick={() => load(row)}>
              Edit
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() => {
            setDefinition(empty);
            setRevision(0);
          }}
        >
          New registration
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void manage({ action: "discover" }).then((value) => {
              const parsed = z
                .object({
                  apps: z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      mode: z.string(),
                      description: z.string().optional(),
                    }),
                  ),
                })
                .safeParse(value);
              if (parsed.success) setApps(parsed.data.apps);
            })
          }
        >
          Discover Dify apps
        </Button>
        {apps.map((app) => (
          <p key={app.id}>
            {app.name} · {app.mode}{" "}
            <Button
              variant="outline"
              disabled={app.mode !== "workflow"}
              onClick={() => {
                setDefinition({
                  ...empty,
                  id: `orchestrator-${app.id.slice(0, 8)}`,
                  appId: app.id,
                  name: app.name,
                  description: app.description ?? "",
                });
                setRevision(0);
              }}
            >
              Register
            </Button>
          </p>
        ))}
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Orchestrator definition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void manage({ action: "metadata", definition }).then((value) => {
                const parsed = z
                  .object({ definition: orchestratorSchema })
                  .safeParse(value);
                if (parsed.success) setDefinition(parsed.data.definition);
              })
            }
          >
            Load app inputs and publication
          </Button>
          {(
            [
              "id",
              "name",
              "description",
              "keyEnv",
              "appId",
              "workflowId",
            ] as const
          ).map((key) => (
            <div key={key}>
              <Label htmlFor={`orchestrator-${key}`}>{key}</Label>
              <Input
                id={`orchestrator-${key}`}
                value={definition[key] ?? ""}
                onChange={(e) =>
                  setDefinition((d) => ({
                    ...d,
                    [key]:
                      e.target.value ||
                      (key === "appId" || key === "workflowId"
                        ? undefined
                        : ""),
                  }))
                }
              />
            </div>
          ))}
          <Label htmlFor="orchestrator-order">Display order</Label>
          <Input
            id="orchestrator-order"
            type="number"
            value={definition.order}
            onChange={(e) =>
              setDefinition((d) => ({ ...d, order: Number(e.target.value) }))
            }
          />
          <div className="flex gap-2">
            <Checkbox
              id="orchestrator-enabled"
              checked={definition.enabled}
              onCheckedChange={(value) =>
                setDefinition((d) => ({ ...d, enabled: value === true }))
              }
            />
            <Label htmlFor="orchestrator-enabled">Selectable by users</Label>
          </div>
          {(["inputs", "pricing", "failureCharging", "recovery"] as const).map(
            (key) => (
              <div
                key={`${definition.id}-${key}-${JSON.stringify(definition[key])}`}
              >
                <Label htmlFor={`orchestrator-${key}`}>{key} contract</Label>
                <Textarea
                  id={`orchestrator-${key}`}
                  defaultValue={JSON.stringify(
                    definition[key] ?? null,
                    null,
                    2,
                  )}
                  onBlur={(e) => {
                    try {
                      setDefinition((d) => ({
                        ...d,
                        [key]: JSON.parse(e.target.value),
                      }));
                      setContractErrors((errors) =>
                        errors.filter((name) => name !== key),
                      );
                      e.target.setCustomValidity("");
                    } catch {
                      setContractErrors((errors) => [
                        ...errors.filter((name) => name !== key),
                        key,
                      ]);
                      setMessage("Enter valid JSON in the contract fields.");
                      e.target.setCustomValidity("Enter valid JSON.");
                    }
                  }}
                />
              </div>
            ),
          )}
          <Label htmlFor="orchestrator-reason">Change reason</Label>
          <Input
            id="orchestrator-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || reason.length < 5}
              onClick={() => void save(true)}
            >
              Validate and save
            </Button>
            <Button
              variant="outline"
              disabled={busy || definition.enabled || reason.length < 5}
              onClick={() => void save(false)}
            >
              Save disabled
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>DSL import and export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="dsl-file">DSL file</Label>
          <Input
            id="dsl-file"
            type="file"
            accept=".yml,.yaml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void file.text().then((text) => {
                  setYaml(text);
                  setImportKey(crypto.randomUUID());
                });
            }}
          />
          <Label htmlFor="dsl-target">
            Existing Dify app ID (leave empty to create a new app)
          </Label>
          <Input
            id="dsl-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setImportKey(crypto.randomUUID());
            }}
          />
          <div className="flex gap-2">
            <Checkbox
              id="dsl-overwrite"
              checked={confirm}
              onCheckedChange={(value) => setConfirm(value === true)}
            />
            <Label htmlFor="dsl-overwrite">
              Confirm overwriting the selected app
            </Label>
          </div>
          <Button
            disabled={busy || !yaml || (!!target && !confirm)}
            onClick={() =>
              void manage({
                action: "import",
                key: importKey,
                yaml,
                name: definition.name,
                ...(target ? { appId: target } : {}),
                confirmOverwrite: confirm,
              }).then((value) => {
                const parsed = z
                  .object({ id: z.string().optional(), status: z.string() })
                  .safeParse(value);
                if (parsed.success) {
                  setMessage(`Import: ${parsed.data.status}`);
                  if (parsed.data.status === "pending")
                    setImportId(parsed.data.id ?? "");
                }
              })
            }
          >
            Import DSL
          </Button>
          {importId && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void manage({
                  action: "confirm-import",
                  key: crypto.randomUUID(),
                  importId,
                })
              }
            >
              Confirm pending import
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy || !target}
            onClick={() =>
              void manage({ action: "export", appId: target }).then((value) => {
                const parsed = z.object({ yaml: z.string() }).safeParse(value);
                if (parsed.success) {
                  const url = URL.createObjectURL(
                    new Blob([parsed.data.yaml], { type: "application/yaml" }),
                  );
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "dify-app.yaml";
                  anchor.click();
                  URL.revokeObjectURL(url);
                }
              })
            }
          >
            Export selected app
          </Button>
          <p>
            Imports do not publish or enable an orchestrator. Resolve
            provider/tool dependencies in Dify before validation.
          </p>
          <p>
            Without management access, import repository DSL files in Dify and
            register their execution credentials here.
          </p>
          <div className="flex flex-wrap gap-3">
            {["generation", "decision", "failure", "recovery"].map((name) => (
              <a
                key={name}
                className="underline"
                href={`/api/admin/orchestrators/templates/${name}`}
              >
                {name} template
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
      <p role="status">{message}</p>
    </div>
  );
}
