"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
import type { runDetail } from "@/lib/server/runs/service";

import { AnswererSelect } from "./answerer-select";

type Detail = Awaited<ReturnType<typeof runDetail>>;
const responseSchema = z.object({ id: z.string() });
function message(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "The request could not be confirmed. Refresh its state before trying again.";
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
        {"automaticError" in decision && decision.automaticError && (
          <p role="status">{decision.automaticError}</p>
        )}
        {"answerSource" in decision && decision.answerSource && (
          <p>
            Answered by{" "}
            {decision.answerSource.type === "persona"
              ? `persona revision ${decision.answerSource.personaRevision}`
              : "User"}
            .
          </p>
        )}
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
  const [restartAnswerer, setRestartAnswerer] = useState("user");
  const selectedPersona = data.personas.find((p) => p.id === restartAnswerer);
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
      {current.answerer && (
        <div className="space-y-2">
          <p>
            Answering as{" "}
            {current.takenOver
              ? "User (taken over)"
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
                Take over
              </Button>
            )}
          <p>
            Main charge: {current.parentCharge ?? "pending"}; persona charge:{" "}
            {current.responderCharge} credits.
          </p>
        </div>
      )}
      {current.application && (
        <p>
          Product save: {current.application}
          {current.application === "failed" && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void command("retry-application")}
            >
              Retry product save
            </Button>
          )}
        </p>
      )}
      {current.artifactId && (
        <Link className="underline" href={`/artifacts/${current.artifactId}`}>
          Open saved artifact
        </Link>
      )}
      {data.responders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl font-semibold">Automatic answers</h2>
          {data.responders.map((r) => (
            <p key={r.id}>
              {r.status} · {r.totalTokens ?? "unknown"} tokens ·{" "}
              {r.settledCredits === null
                ? "credit settlement pending"
                : `${r.settledCredits} credits settled`}
              {r.cost
                ? ` · ${r.cost.amount} ${r.cost.currency} provider cost`
                : ""}
            </p>
          ))}
        </section>
      )}
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
        {!data.events.some((e) => e.event.type === "stage") && (
          <p>
            {[
              "succeeded",
              "failed",
              "cancelled",
              "partially completed",
            ].includes(current.status)
              ? "No workflow stage details were recorded for this attempt."
              : "Waiting for execution evidence."}
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
      {data.attempts.map((attempt) => (
        <Card key={attempt.id}>
          <CardHeader>
            <CardTitle>Attempt {attempt.number}</CardTitle>
            <Badge>{attempt.status}</Badge>
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
            <CardTitle>Start another attempt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AnswererSelect
              personas={data.personas}
              value={restartAnswerer}
              onChange={setRestartAnswerer}
            />
            {selectedPersona && (
              <p>
                Additional persona maximum: {selectedPersona.maximum} credits
                for {selectedPersona.maxCalls} answers. Completed valid answers
                remain chargeable on main Run failure.
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
                : "The main workflow costs zero credits on confirmed failure or cancellation."}
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
