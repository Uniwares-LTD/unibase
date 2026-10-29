"use client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import {
  diagnosticCapabilities,
  diagnosticCapabilityNames,
  grantListSchema,
  grantViewSchema,
  type DiagnosticCapability,
  type GrantView,
} from "@/lib/contracts/diagnostics";
import { DateLabel } from "./localized-value";
import { Notice } from "./page-patterns";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

type Message = { tone: "success" | "error" | "warning"; text: string };
type Duration = "15m" | "1h" | "4h" | "24h";
const metadataDefaults = diagnosticCapabilityNames.filter(
  (name) => diagnosticCapabilities[name] === "metadata",
);
const contentCapabilities = diagnosticCapabilityNames.filter(
  (name) => diagnosticCapabilities[name] === "content",
);
const phraseBytes = (value: string) => new TextEncoder().encode(value).length;
function generatePhrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function DiagnosticAccess({
  availability,
}: {
  availability: { enabled: boolean; redisConfigured: boolean };
}) {
  const translate = useTranslations("ui");
  const id = useId();
  const phraseInput = useRef<HTMLInputElement>(null);
  const [phrase, setPhrase] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [duration, setDuration] = useState<Duration>("1h");
  const [selected, setSelected] = useState<Set<DiagnosticCapability>>(
    () => new Set(metadataDefaults),
  );
  const [grants, setGrants] = useState<GrantView[] | null>(null);
  const [created, setCreated] = useState<GrantView | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = availability.enabled && availability.redisConfigured;

  const describe = useCallback(
    (error: unknown): Message => {
      // Network failures and unconfirmed creation share the uncertain state.
      if (
        !(error instanceof ApiError) ||
        error.code === "DIAGNOSTIC_GRANT_OUTCOME_UNKNOWN"
      )
        return {
          tone: "warning",
          text: translate("mc0f1279ff09a"),
        };
      switch (error.code) {
        case "RECENT_LOGIN_REQUIRED":
          return {
            tone: "error",
            text: translate("mb6e57f92931a"),
          };
        case "DIAGNOSTICS_REDIS_UNAVAILABLE":
          return {
            tone: "error",
            text: translate("m14f461383de8"),
          };
        case "NOT_FOUND":
          return {
            tone: "error",
            text: translate("m7ae114e03b03"),
          };
        case "DIAGNOSTIC_GRANT_LIMIT":
          return {
            tone: "error",
            text: translate("m16c0e73df5a7"),
          };
        case "DIAGNOSTIC_GRANT_UNCERTAIN":
          return {
            tone: "warning",
            text: translate("m8d9c43c5e132"),
          };
        case "DIAGNOSTIC_GRANT_NOT_FOUND":
          return { tone: "error", text: translate("m4809c79d109d") };
        default:
          return { tone: "error", text: error.message };
      }
    },
    [translate],
  );
  const load = useCallback(
    (signal?: AbortSignal) =>
      api("/api/admin/diagnostics/grants", grantListSchema, { signal })
        .then((data) => setGrants(data.grants))
        .catch((error: unknown) => {
          if (!signal?.aborted) setMessage(describe(error));
        }),
    [describe],
  );
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [ready, load]);
  useEffect(() => {
    const input = phraseInput.current;
    // Clear the phrase from the field when the card leaves the page.
    return () => {
      if (input) input.value = "";
    };
  }, []);

  async function create() {
    setBusy(true);
    setMessage(null);
    setCreated(null);
    try {
      const grant = await api(
        "/api/admin/diagnostics/grants",
        grantViewSchema,
        {
          method: "POST",
          body: { phrase, duration, capabilities: [...selected] },
        },
      );
      setPhrase("");
      setRevealed(false);
      setCreated(grant);
      setMessage({ tone: "success", text: translate("m789c519909ea") });
    } catch (error) {
      setMessage(describe(error));
    } finally {
      setBusy(false);
      void load();
    }
  }
  async function revoke(grantId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api(
        "/api/admin/diagnostics/grants",
        z.object({ ok: z.literal(true), recorded: z.boolean() }),
        { method: "DELETE", body: { id: grantId } },
      );
      if (created?.id === grantId) setCreated(null);
      setMessage({ tone: "success", text: translate("m97b0f342d989") });
    } catch (error) {
      setMessage(describe(error));
    } finally {
      setBusy(false);
      void load();
    }
  }
  const toggle = (name: DiagnosticCapability, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  const bytes = phraseBytes(phrase);
  const valid = bytes >= 24 && bytes <= 256 && selected.size > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("md5d6ffdde816")}</CardTitle>
        <CardDescription>{translate("m4891896558f9")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!availability.enabled ? (
          <Notice tone="info" title={translate("m7ae114e03b03")} />
        ) : !availability.redisConfigured ? (
          <Notice tone="warning" title={translate("m14f461383de8")}>
            {translate("m7ec9b1dc7336")}
          </Notice>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${id}-phrase`}>
                {translate("m289abe84dafc")}
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  ref={phraseInput}
                  id={`${id}-phrase`}
                  type={revealed ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={phrase}
                  disabled={busy}
                  aria-describedby={`${id}-phrase-help`}
                  onChange={(event) => setPhrase(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setPhrase(generatePhrase());
                    setRevealed(true);
                  }}
                >
                  {translate("m49e49bb4401e")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !phrase}
                  aria-pressed={revealed}
                  onClick={() => setRevealed((value) => !value)}
                >
                  {revealed
                    ? translate("mac20a57bfde0")
                    : translate("m0df6f1cad36c")}
                </Button>
              </div>
              <p
                id={`${id}-phrase-help`}
                className="text-xs text-muted-foreground"
              >
                {translate("m275192273458")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-duration`}>
                {translate("ma5e4b9f547aa")}
              </Label>
              <Select
                value={duration}
                disabled={busy}
                onValueChange={(value) => setDuration(value as Duration)}
              >
                <SelectTrigger id={`${id}-duration`} className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15m">
                    {translate("m2f18bc2a00e7")}
                  </SelectItem>
                  <SelectItem value="1h">
                    {translate("mf8b8883f0c9d")}
                  </SelectItem>
                  <SelectItem value="4h">
                    {translate("me5bc99278849")}
                  </SelectItem>
                  <SelectItem value="24h">
                    {translate("mf0514e8df841")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                {translate("mc9a175162e07")}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {metadataDefaults.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-${name}`}
                      checked={selected.has(name)}
                      disabled={busy}
                      onCheckedChange={(value) => toggle(name, value === true)}
                    />
                    <Label
                      htmlFor={`${id}-${name}`}
                      className="font-mono text-xs"
                    >
                      {name}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                {translate("m6429e63adaca")}
              </legend>
              <p className="text-xs text-muted-foreground">
                {translate("ma845eeac6c9e")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {contentCapabilities.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-${name}`}
                      checked={selected.has(name)}
                      disabled={busy}
                      onCheckedChange={(value) => toggle(name, value === true)}
                    />
                    <Label
                      htmlFor={`${id}-${name}`}
                      className="font-mono text-xs"
                    >
                      {name}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
            <Button disabled={busy || !valid} onClick={() => void create()}>
              {translate("m9a1a36b83d8e")}
            </Button>
          </>
        )}
        {message && <Notice tone={message.tone} title={message.text} />}
        {created && (
          <Notice tone="info" title={translate("mcb537a764c25")}>
            <p className="font-mono text-sm break-all" dir="ltr">
              {created.id}
            </p>
            <p className="mt-2 text-sm">{translate("mbc0a20cf23e1")}</p>
            <pre
              className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs"
              dir="ltr"
            >
              {`npm run diagnostics -- --grant ${created.id} --capability capabilities.list`}
            </pre>
          </Notice>
        )}
        {ready && (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              {translate("mb01b1a46c2bc")}
            </h3>
            {grants === null ? null : grants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {translate("m4dbe01da882b")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{translate("mcb537a764c25")}</TableHead>
                    <TableHead>{translate("m9460f16ac9b5")}</TableHead>
                    <TableHead>{translate("mf6725f3af08a")}</TableHead>
                    <TableHead>
                      <span className="sr-only">
                        {translate("mff8059dc6752")}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((grant) => (
                    <TableRow key={grant.id}>
                      <TableCell className="font-mono text-xs" dir="ltr">
                        {grant.id}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-md flex-wrap gap-1">
                          {grant.capabilities.map((name) => (
                            <Badge
                              key={name}
                              variant={
                                diagnosticCapabilities[name] === "content"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="font-mono"
                            >
                              {name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DateLabel value={grant.expiresAt} />
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={busy}>
                              {translate("m87e6d00bbf53")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {translate("mda83f79af6e7")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {translate("m26b3b0578965")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {translate("m19766ed6ccb2")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => void revoke(grant.id)}
                              >
                                {translate("m87e6d00bbf53")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
