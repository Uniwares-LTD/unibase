"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { pricingDescription } from "@/lib/ai-pricing";
import { cardRegistry, type SavedCard } from "@/lib/runs/cards";
import { uiPayloadSchema } from "@/lib/contracts/runs";
import { RegisteredCard } from "./registered-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { orchestrators } from "@/lib/server/runs/orchestrators";
import type { runDetail } from "@/lib/server/runs/service";

type Choice = Awaited<ReturnType<typeof orchestrators>>[number];
type Detail = Awaited<ReturnType<typeof runDetail>>;
const responseSchema = z.object({ id: z.string() });
function message(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "The request could not be confirmed. Refresh its state before trying again.";
}
export function RunLanding({
  choices,
  unfinished,
}: {
  choices: Choice[];
  unfinished: { id: string; name: string; status: string }[];
}) {
  const router = useRouter();
  const prefix = useId();
  const [selected, setSelected] = useState(choices[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const choice = choices.find((c) => c.id === selected);
  async function start() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/runs", responseSchema, {
        method: "POST",
        body: {
          key,
          orchestratorId: selected,
          configurationKey: choice.configurationKey,
          inputs: values,
        },
      });
      router.push(`/runs/${result.id}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(name: string, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("orchestratorId", selected);
      form.set("key", crypto.randomUUID());
      form.set("file", file);
      const result = await api(
        "/api/run-uploads",
        z.object({ id: z.string(), status: z.string() }),
        { method: "POST", body: form, timeoutMs: 120000 },
      );
      if (result.status !== "ready") throw new Error();
      setValues((v) => ({ ...v, [name]: result.id }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Start a run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label htmlFor={`${prefix}-orchestrator`}>Orchestrator</Label>
          <Select
            value={selected}
            onValueChange={(id) => {
              setSelected(id);
              setValues({});
            }}
          >
            <SelectTrigger id={`${prefix}-orchestrator`}>
              <SelectValue placeholder="Select an orchestrator" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {choice && (
            <>
              <p>{choice.description}</p>
              {choice.inputs.map((field) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={`${prefix}-${field.name}`}>
                    {field.label}
                    {field.required ? " (required)" : ""}
                  </Label>
                  {field.kind === "paragraph" ? (
                    <Textarea
                      id={`${prefix}-${field.name}`}
                      value={values[field.name] ?? ""}
                      maxLength={field.maxLength ?? 4000}
                      onChange={(e) =>
                        setValues((v) => ({
                          ...v,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  ) : field.kind === "select" ? (
                    <Select
                      value={String(values[field.name] ?? "")}
                      onValueChange={(value) =>
                        setValues((v) => ({ ...v, [field.name]: value }))
                      }
                    >
                      <SelectTrigger id={`${prefix}-${field.name}`}>
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={`${prefix}-${field.name}`}
                      type={
                        field.kind === "file"
                          ? "file"
                          : field.kind === "number"
                            ? "number"
                            : "text"
                      }
                      maxLength={
                        field.kind === "text"
                          ? (field.maxLength ?? 4000)
                          : undefined
                      }
                      disabled={busy}
                      {...(field.kind === "file"
                        ? {}
                        : { value: values[field.name] ?? "" })}
                      onChange={(e) => {
                        if (field.kind === "file") {
                          if (e.target.files?.[0])
                            void upload(field.name, e.target.files[0]);
                        } else
                          setValues((v) => ({
                            ...v,
                            [field.name]:
                              field.kind === "number"
                                ? Number(e.target.value)
                                : e.target.value,
                          }));
                      }}
                    />
                  )}
                  {field.kind === "file" && values[field.name] && (
                    <p>File ready.</p>
                  )}
                </div>
              ))}
              <p className="text-sm text-muted-foreground">
                {pricingDescription(
                  choice.pricing ?? { mode: "fixed", credits: 1 },
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {choice.failureCharging === "verified-usage"
                  ? "Verified usage may be charged after failure or cancellation. The fixed base applies on success."
                  : "Confirmed failed or cancelled attempts cost zero credits."}
              </p>
              <Button
                disabled={busy || !choice.ready}
                onClick={() => void start()}
              >
                {busy ? "Starting…" : "Run orchestrator"}
              </Button>
            </>
          )}
          {!choices.length && (
            <p>
              No orchestrators are available. An administrator can enable one.
            </p>
          )}
          <p role="status">{error}</p>
        </CardContent>
      </Card>
      {unfinished.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Continue a run</h2>
          {unfinished.map((run) => (
            <p key={run.id}>
              <Link className="underline" href={`/runs/${run.id}`}>
                {run.name}
              </Link>{" "}
              · {run.status}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
function savedCard(
  card: z.infer<typeof uiPayloadSchema>["cards"][number],
  response: unknown,
): SavedCard {
  return {
    id: card.id,
    content: card.content,
    status: "active",
    response:
      response === undefined ? null : (response as SavedCard["response"]),
    responseAction: null,
    createdAt: "",
    answeredAt: null,
    sourceJobId: null,
  };
}
function Decision({
  decision,
  runId,
  attemptId,
  refresh,
}: {
  decision: Detail["decisions"][number];
  runId: string;
  attemptId: string;
  refresh: () => void;
}) {
  const prefix = useId();
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    "defaults" in decision ? (decision.defaults ?? {}) : {},
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const parsed = uiPayloadSchema.safeParse({
    version: 1,
    cards: decision.cards,
  });
  const cards = parsed.success ? parsed.data.cards : [];
  const active = decision.status === "pending";
  async function submit(action: string) {
    setBusy(true);
    try {
      await api(
        `/api/runs/${runId}/decisions/${decision.id}`,
        z.object({ status: z.string() }),
        { method: "POST", body: { key, action, answers } },
      );
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(name: string, files: FileList) {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("attemptId", attemptId);
        form.set("key", crypto.randomUUID());
        form.set("file", file);
        const result = await api(
          `/api/runs/${runId}/uploads`,
          z.object({ id: z.string(), status: z.string() }),
          { method: "POST", body: form, timeoutMs: 120000 },
        );
        if (result.status !== "ready") throw new Error();
        ids.push(result.id);
      }
      const field = decision.inputs.find(
        (f) => f.output_variable_name === name,
      );
      setAnswers((v) => ({
        ...v,
        [name]: field?.type === "file-list" ? ids : ids[0],
      }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{decision.title}</CardTitle>
        <Badge>{decision.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {"error" in decision && <p role="status">{decision.error}</p>}
        {"description" in decision && (
          <p className="whitespace-pre-wrap">{decision.description}</p>
        )}
        {cards.map((card) => (
          <div key={card.id}>
            <RegisteredCard
              card={savedCard(card, answers[card.id])}
              disabled={busy || !active}
              allowedAssetIds={cardRegistry
                .get(card.content.type, card.content.version)
                .assets(card.content.data)}
              onRespond={(_action, value) =>
                setAnswers((v) => ({ ...v, [card.id]: value }))
              }
            />
            {card.id in answers && (
              <p role="status">
                Answer ready. Select a continuation action below.
              </p>
            )}
          </div>
        ))}
        {!cards.length &&
          decision.inputs.map((field) => (
            <div key={field.output_variable_name} className="space-y-2">
              <Label htmlFor={`${prefix}-${field.output_variable_name}`}>
                {field.output_variable_name}
              </Label>
              {field.type === "select" ? (
                <Select
                  disabled={!active || busy}
                  value={String(answers[field.output_variable_name] ?? "")}
                  onValueChange={(value) =>
                    setAnswers((v) => ({
                      ...v,
                      [field.output_variable_name]: value,
                    }))
                  }
                >
                  <SelectTrigger id={`${prefix}-${field.output_variable_name}`}>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? field.option_source?.value ?? []).map(
                      (option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              ) : field.type === "paragraph" ? (
                <Textarea
                  id={`${prefix}-${field.output_variable_name}`}
                  disabled={!active || busy}
                  value={String(
                    answers[field.output_variable_name] ??
                      ("defaults" in decision
                        ? decision.defaults?.[field.output_variable_name]
                        : "") ??
                      "",
                  )}
                  onChange={(e) =>
                    setAnswers((v) => ({
                      ...v,
                      [field.output_variable_name]: e.target.value,
                    }))
                  }
                />
              ) : (
                <Input
                  id={`${prefix}-${field.output_variable_name}`}
                  type="file"
                  multiple={field.type === "file-list"}
                  disabled={!active || busy}
                  onChange={(e) => {
                    if (e.target.files)
                      void upload(field.output_variable_name, e.target.files);
                  }}
                />
              )}
            </div>
          ))}
        {active && (
          <div className="flex flex-wrap gap-2">
            {decision.actions.map((action) => (
              <Button
                key={action.id}
                disabled={
                  busy ||
                  cards.some(
                    (c) =>
                      cardRegistry.get(c.content.type, c.content.version)
                        .actions.length && !(c.id in answers),
                  )
                }
                onClick={() => void submit(action.id)}
              >
                {action.title}
              </Button>
            ))}
          </div>
        )}
        {!active && "answers" in decision && decision.answers && (
          <pre className="overflow-auto whitespace-pre-wrap break-words text-sm">
            {JSON.stringify(decision.answers, null, 2)}
          </pre>
        )}
        <p role="status">{error}</p>
      </CardContent>
    </Card>
  );
}
export function RunDetail({ initial }: { initial: Detail }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restartInputs, setRestartInputs] = useState(
    initial.attempts.at(-1)!.inputs,
  );
  const current = data.attempts.at(-1)!;
  async function refresh() {
    try {
      const result = await api(`/api/runs/${data.id}`, z.custom<Detail>());
      setData(result);
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await api(`/api/runs/${initial.id}`, z.custom<Detail>(), {
          signal: controller.signal,
        });
        if (!stopped) setData(next);
      } catch (e) {
        if (!stopped) setError(message(e));
      }
      if (!stopped)
        timer = setTimeout(() => void poll(), initial.pollSeconds * 1000);
    }
    timer = setTimeout(() => void poll(), initial.pollSeconds * 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [initial.id, initial.pollSeconds]);
  async function command(
    action: "cancel" | "restart" | "recover" | "test-stage",
    stage?: string,
  ) {
    setBusy(true);
    try {
      await api(`/api/runs/${data.id}`, responseSchema, {
        method: "POST",
        body: {
          key: crypto.randomUUID(),
          action,
          attemptId: current.id,
          ...(action !== "cancel"
            ? {
                configurationKey: data.configuration?.configurationKey,
                inputs: restartInputs,
              }
            : {}),
          ...(stage ? { stage } : {}),
        },
      });
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function uploadRestart(name: string, file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("orchestratorId", data.configuration!.id);
      form.set("key", crypto.randomUUID());
      form.set("file", file);
      const saved = await api(
        "/api/run-uploads",
        z.object({ id: z.string(), status: z.string() }),
        { method: "POST", body: form, timeoutMs: 120000 },
      );
      if (saved.status !== "ready") throw new Error();
      setRestartInputs((v) => ({ ...v, [name]: saved.id }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>{data.status}</Badge>
        <p>
          Attempt {current.number} · {current.elapsedSeconds}s elapsed ·{" "}
          {current.chargedCredits === null
            ? `${current.credits} credits reserved`
            : `${current.chargedCredits} credits charged`}
        </p>
        <Button variant="outline" onClick={() => void refresh()}>
          Refresh
        </Button>
        {[
          "queued",
          "starting",
          "running",
          "awaiting input",
          "reconciling",
        ].includes(data.status) && (
          <Button
            variant="outline"
            disabled={busy || current.cancelRequested}
            onClick={() => void command("cancel")}
          >
            {current.cancelRequested ? "Cancellation pending" : "Cancel run"}
          </Button>
        )}
      </div>
      <p role="status">{error}</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Tracing</h2>
        {data.events
          .filter((e) => e.event.type === "stage")
          .map((e) => (
            <p key={e.id}>
              {e.event.title} · {e.event.status}
              {e.event.elapsedMs !== null ? ` · ${e.event.elapsedMs} ms` : ""}
            </p>
          ))}
        {!data.events.length && <p>Waiting for execution evidence.</p>}
      </section>
      {data.decisions.map((decision) => (
        <Decision
          key={decision.id}
          decision={decision}
          runId={data.id}
          attemptId={
            ("attemptId" in decision ? decision.attemptId : undefined) ??
            current.id
          }
          refresh={() => void refresh()}
        />
      ))}
      {data.attempts.map((attempt) => (
        <Card key={attempt.id}>
          <CardHeader>
            <CardTitle>Attempt {attempt.number}</CardTitle>
            <Badge>{attempt.status}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>
              {attempt.createdAt} · {attempt.failure ?? ""}
            </p>
            {attempt.result && (
              <>
                <p className="whitespace-pre-wrap break-words">
                  {attempt.result.text}
                </p>
                {attempt.result.failure && (
                  <p role="status">{attempt.result.failure}</p>
                )}
                {attempt.result.images.map(
                  (image: { id: string; name: string }) => (
                    <Image
                      key={image.id}
                      unoptimized
                      src={`/api/run-assets/${image.id}`}
                      width={600}
                      height={400}
                      alt={image.name}
                      className="max-h-96 w-full object-contain"
                    />
                  ),
                )}
                {attempt.result.cards.map(
                  (card: z.infer<typeof uiPayloadSchema>["cards"][number]) => (
                    <RegisteredCard
                      key={card.id}
                      card={savedCard(card, null)}
                      disabled
                      allowedAssetIds={cardRegistry
                        .get(card.content.type, card.content.version)
                        .assets(card.content.data)}
                      onRespond={() => {}}
                    />
                  ),
                )}
              </>
            )}
          </CardContent>
        </Card>
      ))}
      {data.canRestart && data.configuration && (
        <Card>
          <CardHeader>
            <CardTitle>Start another attempt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.configuration.inputs.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`restart-${field.name}`}>{field.label}</Label>
                {field.kind === "select" ? (
                  <Select
                    value={String(restartInputs[field.name] ?? "")}
                    onValueChange={(value) =>
                      setRestartInputs((v) => ({ ...v, [field.name]: value }))
                    }
                  >
                    <SelectTrigger id={`restart-${field.name}`}>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.kind === "paragraph" ? (
                  <Textarea
                    id={`restart-${field.name}`}
                    value={String(restartInputs[field.name] ?? "")}
                    onChange={(e) =>
                      setRestartInputs((v) => ({
                        ...v,
                        [field.name]: e.target.value,
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`restart-${field.name}`}
                    type={
                      field.kind === "number"
                        ? "number"
                        : field.kind === "file"
                          ? "file"
                          : "text"
                    }
                    {...(field.kind === "file"
                      ? {}
                      : { value: String(restartInputs[field.name] ?? "") })}
                    onChange={(e) => {
                      if (field.kind === "file" && e.target.files?.[0])
                        void uploadRestart(field.name, e.target.files[0]);
                      else
                        setRestartInputs((v) => ({
                          ...v,
                          [field.name]:
                            field.kind === "number"
                              ? Number(e.target.value)
                              : e.target.value,
                        }));
                    }}
                  />
                )}
              </div>
            ))}
            <p>
              {pricingDescription(
                data.configuration.pricing ?? { mode: "fixed", credits: 1 },
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              {data.configuration.failureCharging === "verified-usage"
                ? "Verified usage may be charged after failure or cancellation. The fixed base applies on success."
                : "Confirmed failed or cancelled attempts cost zero credits."}
            </p>
            <Button
              disabled={busy || !data.configuration.ready}
              onClick={() => void command("restart")}
            >
              Restart run
            </Button>
            {data.isAdmin &&
              data.configuration.recovery?.diagnostic &&
              data.configuration.recovery.stages.map((stage) => (
                <Button
                  key={stage}
                  variant="outline"
                  disabled={busy}
                  onClick={() => void command("test-stage", stage)}
                >
                  Test {stage} stage
                </Button>
              ))}
            {current.result?.checkpoint &&
              data.configuration.recovery?.version ===
                current.result.checkpoint.version && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void command("recover", current.result.checkpoint.stage)
                  }
                >
                  Retry stage
                </Button>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
