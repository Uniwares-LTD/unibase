"use client";
import { CurrencyLabel, StateLabel } from "@/components/localized-value";

import { useTranslations } from "next-intl";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { PricingDescription } from "@/components/pricing-description";
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
import type { runDetail } from "@/lib/server/runs/service";

import { AnswererSelect } from "./answerer-select";

type Detail = Awaited<ReturnType<typeof runDetail>>;
const responseSchema = z.object({ id: z.string() });
function message(
  error: unknown,
  translate: ReturnType<typeof useTranslations<"ui">>,
) {
  return error instanceof ApiError ? error.message : translate("m96f22b8e7ee5");
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
  const translate = useTranslations("ui");

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
  const raw = "responseMode" in decision && decision.responseMode === "raw-v1";
  async function submit(action: string) {
    setBusy(true);
    try {
      await api(
        `/api/runs/${runId}/decisions/${decision.id}`,
        z.object({ status: z.string() }),
        {
          method: "POST",
          body: {
            key,
            action,
            ...(raw
              ? { response: cards.length ? answers : (answers.response ?? "") }
              : { answers }),
          },
        },
      );
      refresh();
    } catch (e) {
      setError(message(e, translate));
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
      setError(message(e, translate));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{decision.title}</CardTitle>
        <Badge>
          <StateLabel value={decision.status} />
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {"error" in decision && <p role="status">{decision.error}</p>}
        {"automaticError" in decision && decision.automaticError && (
          <p role="status">{decision.automaticError}</p>
        )}
        {"answerSource" in decision && decision.answerSource && (
          <p>
            {translate("m1cbdadbedf5c")}{" "}
            {decision.answerSource.type === "persona"
              ? `persona revision ${decision.answerSource.personaRevision}`
              : translate("mb512d97e7cbf")}
            .
          </p>
        )}
        {"description" in decision && (
          <p className="whitespace-pre-wrap">{decision.description}</p>
        )}
        {cards.map((card) => (
          <div key={card.id}>
            <RegisteredCard
              rawResponse={raw}
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
              <p role="status">{translate("m66127c4a57df")} </p>
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
                    <SelectValue placeholder={translate("mc7f937836f5d")} />
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
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const [data, setData] = useState(initial);
  const [pages, setPages] = useState<Record<string, string>>({});
  const pageQuery = new URLSearchParams(pages).toString();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [restartInputs, setRestartInputs] = useState(
    initial.attempts.at(-1)!.inputs,
  );
  const current = data.attempts.at(-1)!;
  const [restartAnswerer, setRestartAnswerer] = useState("user");
  const selectedPersona = data.personas.find((p) => p.id === restartAnswerer);
  async function refresh() {
    try {
      const result = await api(
        `/api/runs/${data.id}?${pageQuery}`,
        z.custom<Detail>(),
      );
      setData(result);
    } catch (e) {
      setError(message(e, translate));
    }
  }
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const next = await api(
          `/api/runs/${initial.id}?${pageQuery}`,
          z.custom<Detail>(),
          {
            signal: controller.signal,
          },
        );
        if (!stopped) setData(next);
      } catch (e) {
        if (!stopped) setError(message(e, translate));
      }
      if (!stopped)
        timer = setTimeout(() => void poll(), initial.pollSeconds * 1000);
    }
    void poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [initial.id, initial.pollSeconds, pageQuery, translate]);
  async function command(
    action:
      | "cancel"
      | "restart"
      | "recover"
      | "test-stage"
      | "take-over"
      | "retry-application",
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
          answerer: selectedPersona
            ? {
                type: "persona",
                id: selectedPersona.id,
                revision: selectedPersona.revision,
                configurationKey: selectedPersona.configurationKey,
              }
            : { type: "user" },
          ...(stage ? { stage } : {}),
        },
      });
      await refresh();
    } catch (e) {
      setError(message(e, translate));
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
      setError(message(e, translate));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>
          <StateLabel value={data.status} />
        </Badge>
        <p>
          {translate("mc934cc71493d")} {current.number} ·{" "}
          {current.elapsedSeconds}
          {translate("m564d3c6236c7")}{" "}
          {current.chargedCredits === null
            ? `${current.credits} credits reserved`
            : `${current.chargedCredits} credits charged`}
        </p>
        <Button variant="outline" onClick={() => void refresh()}>
          {translate("m0e9161011702")}{" "}
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
            {current.cancelRequested
              ? translate("mab1da702bdb4")
              : translate("m56bccd9d49b0")}
          </Button>
        )}
      </div>
      {current.answerer && (
        <div className="space-y-2">
          <p>
            {translate("m35573822af5f")}{" "}
            {current.takenOver
              ? translate("mfdcbb104a862")
              : `${current.answerer.name}, revision ${current.answerer.revision}`}
            .
          </p>
          {!current.takenOver &&
            [
              "queued",
              "starting",
              "running",
              "awaiting input",
              "reconciling",
            ].includes(data.status) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void command("take-over")}
              >
                {translate("m66abfef02cd8")}{" "}
              </Button>
            )}
          <p>
            {translate("medc4cfc4982a")} {current.parentCharge ?? "pending"}
            {translate("med42bd5f120f")} {current.responderCharge}{" "}
            {translate("meb492cb82670")}{" "}
          </p>
        </div>
      )}
      {current.application && (
        <p>
          {translate("me8d51a5ad1cd")} {current.application}
          {current.application === "failed" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void command("retry-application")}
            >
              {translate("me4a8905b1395")}{" "}
            </Button>
          )}
        </p>
      )}
      {current.artifactId && (
        <Link className="underline" href={`/artifacts/${current.artifactId}`}>
          {translate("m5c2d5c2c1036")}{" "}
        </Link>
      )}
      {data.responders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">
            {translate("m7ccd4bca1a1d")}
          </h2>
          {data.responders.map((r) => (
            <p key={r.id}>
              <StateLabel value={r.status} /> ·{" "}
              {r.totalTokens ?? common("unknown")} {translate("mf28ea827611f")}{" "}
              {r.settledCredits === null
                ? common("settlementPending")
                : common("settled", { count: r.settledCredits })}
              {r.cost && (
                <CurrencyLabel
                  amount={r.cost.amount}
                  currency={r.cost.currency}
                />
              )}
            </p>
          ))}
        </section>
      )}
      <p role="status">{error}</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{translate("m69e561abfb58")}</h2>
        {data.events
          .filter((e) => e.event.type === "stage")
          .map((e) => (
            <p key={e.id}>
              {e.event.title} · {e.event.status}
              {e.event.elapsedMs !== null ? ` · ${e.event.elapsedMs} ms` : ""}
            </p>
          ))}
        {!data.events.some((e) => e.event.type === "stage") && (
          <p>
            {[
              "succeeded",
              "failed",
              "cancelled",
              "partially completed",
            ].includes(current.status)
              ? translate("m9f173522b4e5")
              : translate("m0cf47511f846")}
          </p>
        )}
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
      <nav
        aria-label={translate("mde427024aac2")}
        className="flex flex-wrap gap-2"
      >
        {(
          [
            ["actionable", data.actionable.next, translate("mb45e85e04627")],
            [
              "decisions",
              data.decisionHistory.next,
              translate("m5f487fd06eb2"),
            ],
            ["events", data.eventHistory.next, translate("m672bb0139b65")],
          ] as const
        ).map(
          ([kind, next, label]) =>
            next && (
              <Button
                key={kind}
                variant="outline"
                onClick={() => setPages((p) => ({ ...p, [kind]: next }))}
              >
                {label}
              </Button>
            ),
        )}
        {Object.keys(pages).length > 0 && (
          <Button variant="outline" onClick={() => setPages({})}>
            {translate("m58515cdc3981")}{" "}
          </Button>
        )}
      </nav>
      {data.attempts.map((attempt) => (
        <Card key={attempt.id}>
          <CardHeader>
            <CardTitle>
              {translate("mc934cc71493d")} {attempt.number}
            </CardTitle>
            <Badge>
              <StateLabel value={attempt.status} />
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p>{attempt.createdAt}</p>
            {attempt.failure && (
              <p role="alert" className="break-words text-destructive">
                {attempt.failure}
              </p>
            )}
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
            <CardTitle>{translate("m8928ee03f0a7")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AnswererSelect
              personas={data.personas}
              value={restartAnswerer}
              onChange={setRestartAnswerer}
            />
            {selectedPersona && (
              <p>
                {translate("me019adcccad2")} {selectedPersona.maximum}{" "}
                {translate("mfd1308912dd1")} {selectedPersona.maxCalls}{" "}
                {translate("m3c28816ad03e")}{" "}
              </p>
            )}
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
                      <SelectValue placeholder={translate("mc7f937836f5d")} />
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
              <PricingDescription
                pricing={
                  data.configuration.pricing ?? { mode: "fixed", credits: 1 }
                }
              />
            </p>
            <p className="text-sm text-muted-foreground">
              {data.configuration.failureCharging === "verified-usage"
                ? translate("m5d401b01fc4f")
                : translate("m2790bb24347a")}
            </p>
            <Button
              disabled={busy || !data.configuration.ready}
              onClick={() => void command("restart")}
            >
              {translate("md07c9916a5c9")}{" "}
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
                  {translate("m532eaabd9574")} {stage}{" "}
                  {translate("mc7ff6dcd94d7")}{" "}
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
                  {translate("m65e466bf2710")}{" "}
                </Button>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
