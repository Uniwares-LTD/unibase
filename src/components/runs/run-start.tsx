"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { pricingDescription } from "@/lib/ai-pricing";
import type { personaChoices } from "@/lib/server/runs/personas";
import type { orchestrators } from "@/lib/server/runs/orchestrators";
import type { runStartSchema } from "@/lib/contracts/runs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AnswererSelect } from "./answerer-select";

type Choice = Awaited<ReturnType<typeof orchestrators>>[number];
export type ArtifactOption = { id: string; title: string; revision: number };
type Submission = {
  input: z.infer<typeof runStartSchema>;
  create: { id: string; title: string } | null;
};
const idResponse = z.object({ id: z.string() });
// These server checks precede admission. Other failures may have lost a
// successful response, so keep the exact request immutable for reconciliation.
const editableErrors = new Set([
  "INVALID_INPUT",
  "INVALID_ORCHESTRATOR",
  "CONFIGURATION_CHANGED",
  "ORCHESTRATOR_UNAVAILABLE",
  "ARTIFACT_REQUIRED",
  "ARTIFACT_NOT_FOUND",
  "AI_DISABLED",
  "INSUFFICIENT_CREDITS",
  "PERSONA_UNAVAILABLE",
  "PERSONA_CHANGED",
]);

export function RunLanding({
  choices,
  unfinished,
  personas = [],
  artifacts: initialArtifacts = [],
  artifactId,
}: {
  choices: Choice[];
  unfinished: { id: string; name: string; status: string }[];
  personas?: Awaited<ReturnType<typeof personaChoices>>;
  artifacts?: ArtifactOption[];
  artifactId?: string;
}) {
  const router = useRouter();
  const prefix = useId();
  const [selected, setSelected] = useState(
    () =>
      (artifactId
        ? choices.find((c) => c.requiresArtifact && c.ready)
        : choices.find((c) => c.ready)
      )?.id ??
      choices[0]?.id ??
      "",
  );
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [answerer, setAnswerer] = useState("user");
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [artifactMode, setArtifactMode] = useState(
    artifactId ? "existing" : "new",
  );
  const [selectedArtifact, setSelectedArtifact] = useState(
    artifactId ?? initialArtifacts[0]?.id ?? "",
  );
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "artifact" | "run" | "upload">(
    "idle",
  );
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const submission = useRef<Submission | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const busy = phase !== "idle";
  const frozen = busy || locked;
  const choice = choices.find((c) => c.id === selected);
  const persona = personas.find((p) => p.id === answerer);
  const artifact = artifacts.find((a) => a.id === selectedArtifact);
  const pricing = choice?.pricing ?? { mode: "fixed" as const, credits: 1 };
  const maximum = maximumCredits(pricing) + (persona?.maximum ?? 0);

  function invalid(text: string, id: string) {
    setError(text);
    document.getElementById(id)?.focus();
  }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || busy || !choice.ready) return;
    setError("");
    if (!submission.current) {
      const missing = choice.inputs.find(
        (f) =>
          f.required && (values[f.name] === undefined || values[f.name] === ""),
      );
      if (missing)
        return invalid(
          `Complete ${missing.label} before starting.`,
          `${prefix}-${missing.name}`,
        );
      if (choice.requiresArtifact && artifactMode === "existing" && !artifact)
        return invalid(
          "Choose a saved artifact before starting.",
          `${prefix}-artifact`,
        );
      if (choice.requiresArtifact && artifactMode === "new" && !title.trim())
        return invalid(
          "Enter a title for your new artifact.",
          `${prefix}-title`,
        );
      const create =
        choice.requiresArtifact && artifactMode === "new"
          ? { id: crypto.randomUUID(), title: title.trim() }
          : null;
      submission.current = {
        create,
        input: {
          key,
          orchestratorId: choice.id,
          configurationKey: choice.configurationKey,
          inputs: { ...values },
          answerer: persona
            ? {
                type: "persona",
                id: persona.id,
                revision: persona.revision,
                configurationKey: persona.configurationKey,
              }
            : { type: "user" },
          ...(choice.requiresArtifact
            ? { artifactId: create?.id ?? artifact!.id }
            : {}),
        },
      };
    }
    const request = submission.current;
    setLocked(true);
    let navigating = false;
    try {
      if (request.create) {
        setPhase("artifact");
        await api("/api/artifacts", idResponse, {
          method: "POST",
          body: request.create,
        });
        const created = request.create;
        setArtifacts((rows) =>
          rows.some((a) => a.id === created.id)
            ? rows
            : [{ ...created, revision: 0 }, ...rows],
        );
        setSelectedArtifact(created.id);
        setArtifactMode("existing");
      }
      setPhase("run");
      const result = await api("/api/runs", idResponse, {
        method: "POST",
        body: request.input,
      });
      navigating = true;
      router.push(`/runs/${result.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "The request could not be confirmed. Retry with this setup, or check Runs for its current state.",
      );
      if (e instanceof ApiError && editableErrors.has(e.code)) {
        submission.current = null;
        setLocked(false);
      }
    } finally {
      if (!navigating) setPhase("idle");
    }
  }
  async function upload(name: string, file: File) {
    setPhase("upload");
    setError("");
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
      setError(
        e instanceof ApiError
          ? e.message
          : "The file could not be uploaded. Please try again.",
      );
    } finally {
      setPhase("idle");
    }
  }

  const emptyState = (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>No workflows available</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          Ask an administrator to enable a workflow, then return here to start a
          Run.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/runs">View your Runs</Link>
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {!choices.length ? (
        emptyState
      ) : (
        <form
          onSubmit={(event) => void start(event)}
          aria-busy={busy}
          className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
        >
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>
                <h2>Set up your Run</h2>
              </CardTitle>
              <CardDescription>
                Choose what to create and where to save it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <fieldset disabled={frozen} className="space-y-6">
                <legend className="sr-only">Run setup</legend>
                <div className="space-y-2">
                  <Label htmlFor={`${prefix}-workflow`}>Workflow</Label>
                  <Select
                    value={selected}
                    disabled={frozen}
                    onValueChange={(id) => {
                      setSelected(id);
                      setValues({});
                      setError("");
                    }}
                  >
                    <SelectTrigger id={`${prefix}-workflow`} className="w-full">
                      <SelectValue placeholder="Choose a workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-sm text-muted-foreground">
                    {choice?.description}
                  </p>
                </div>
                {choice?.inputs.map((field) => (
                  <div key={field.name} className="space-y-2">
                    <Label htmlFor={`${prefix}-${field.name}`}>
                      {field.label}
                      {field.required ? " (required)" : ""}
                    </Label>
                    {field.kind === "paragraph" ? (
                      <Textarea
                        id={`${prefix}-${field.name}`}
                        name={field.name}
                        autoComplete="off"
                        required={field.required}
                        disabled={frozen}
                        maxLength={field.maxLength ?? 4000}
                        value={values[field.name] ?? ""}
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
                        disabled={frozen}
                        onValueChange={(value) =>
                          setValues((v) => ({ ...v, [field.name]: value }))
                        }
                      >
                        <SelectTrigger
                          id={`${prefix}-${field.name}`}
                          className="w-full"
                        >
                          <SelectValue placeholder="Choose an option" />
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
                        name={field.name}
                        autoComplete="off"
                        required={field.required}
                        disabled={frozen}
                        type={
                          field.kind === "file"
                            ? "file"
                            : field.kind === "number"
                              ? "number"
                              : "text"
                        }
                        step={field.kind === "number" ? "any" : undefined}
                        maxLength={
                          field.kind === "text"
                            ? (field.maxLength ?? 4000)
                            : undefined
                        }
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
                                field.kind === "number" && e.target.value !== ""
                                  ? Number(e.target.value)
                                  : e.target.value,
                            }));
                        }}
                      />
                    )}
                    {field.kind === "file" && values[field.name] && (
                      <p className="text-sm text-muted-foreground">
                        File ready.
                      </p>
                    )}
                  </div>
                ))}
                {choice?.requiresArtifact && (
                  <section
                    className="space-y-4"
                    aria-labelledby={`${prefix}-save-heading`}
                  >
                    <Separator />
                    <div>
                      <h2
                        id={`${prefix}-save-heading`}
                        className="font-semibold"
                      >
                        Save your results
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        An artifact keeps your content, images, and revision
                        history.
                      </p>
                    </div>
                    <RadioGroup
                      value={artifactMode}
                      onValueChange={setArtifactMode}
                      disabled={frozen}
                      aria-label="Save results to"
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      <Label
                        htmlFor={`${prefix}-new`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent/50"
                      >
                        <RadioGroupItem id={`${prefix}-new`} value="new" />
                        Create a new artifact
                      </Label>
                      <Label
                        htmlFor={`${prefix}-existing`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent/50"
                      >
                        <RadioGroupItem
                          id={`${prefix}-existing`}
                          value="existing"
                          disabled={!artifacts.length}
                        />
                        Use an existing artifact
                      </Label>
                    </RadioGroup>
                    {artifactMode === "new" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${prefix}-title`}>
                          Artifact title (required)
                        </Label>
                        <Input
                          id={`${prefix}-title`}
                          name="artifactTitle"
                          autoComplete="off"
                          required
                          maxLength={100}
                          value={title}
                          placeholder="e.g. Firefly adventure"
                          onChange={(e) => setTitle(e.target.value)}
                        />
                        <p className="text-sm text-muted-foreground">
                          Created when you start this Run.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor={`${prefix}-artifact`}>
                          Saved artifact
                        </Label>
                        <Select
                          value={selectedArtifact}
                          disabled={frozen}
                          onValueChange={setSelectedArtifact}
                        >
                          <SelectTrigger
                            id={`${prefix}-artifact`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Choose a saved artifact" />
                          </SelectTrigger>
                          <SelectContent>
                            {artifacts.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.title} · Revision {a.revision}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {artifact && (
                          <p className="text-sm text-muted-foreground">
                            Results will be saved as a new revision of{" "}
                            <Link
                              href={`/artifacts/${artifact.id}`}
                              className="underline underline-offset-4"
                            >
                              {artifact.title}
                            </Link>
                            .
                          </p>
                        )}
                      </div>
                    )}
                    {!artifacts.length && (
                      <p className="text-sm text-muted-foreground">
                        No saved artifacts yet. Create your first one here.
                      </p>
                    )}
                  </section>
                )}
              </fieldset>
            </CardContent>
          </Card>
          <Card className="min-w-0 lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle>
                <h2>Review and start</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <AnswererSelect
                personas={personas}
                value={answerer}
                onChange={setAnswerer}
                disabled={frozen}
              />
              <p className="text-sm text-muted-foreground">
                {persona
                  ? `${persona.name} will answer questions automatically. You can take over during the Run.`
                  : "You’ll answer questions when the workflow needs your input."}
              </p>
              <Separator />
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Workflow</dt>
                  <dd className="break-words font-medium">{choice?.name}</dd>
                </div>
                {choice?.requiresArtifact && (
                  <div>
                    <dt className="text-muted-foreground">Save to</dt>
                    <dd className="break-words font-medium">
                      {artifactMode === "new"
                        ? title.trim() || "New artifact"
                        : artifact?.title || "Choose an artifact"}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Maximum reserved</dt>
                  <dd className="font-medium">
                    {maximum} {maximum === 1 ? "credit" : "credits"}
                  </dd>
                </div>
              </dl>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{pricingDescription(pricing)}</p>
                {persona && (
                  <p>
                    Persona: up to {persona.maxCalls} answers, {persona.maximum}{" "}
                    credits maximum. Completed valid answers are charged even if
                    the Run fails or you take over.
                  </p>
                )}
                <p>
                  {choice?.failureCharging === "verified-usage"
                    ? "Verified usage may be charged after failure or cancellation."
                    : "The main workflow costs zero credits on confirmed failure or cancellation."}
                </p>
              </div>
              {!choice?.ready && (
                <p role="status">
                  This workflow is not ready. Ask an administrator to check it.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {locked && !busy && (
                <p className="text-sm text-muted-foreground">
                  Your setup is kept for a safe retry. You can also{" "}
                  <Link href="/runs" className="underline">
                    check your Runs
                  </Link>
                  .
                </p>
              )}
              <Button
                type="submit"
                disabled={busy || !choice?.ready}
                className="h-auto w-full whitespace-normal py-3"
              >
                {phase === "artifact"
                  ? "Creating artifact…"
                  : phase === "upload"
                    ? "Uploading file…"
                    : phase === "run"
                      ? "Starting Run…"
                      : locked
                        ? "Retry start"
                        : choice?.requiresArtifact && artifactMode === "new"
                          ? "Create artifact and start Run"
                          : "Start Run"}
              </Button>
            </CardContent>
          </Card>
        </form>
      )}
      {unfinished.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Continue a Run</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {unfinished.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 break-words font-medium">
                  {run.name}
                </span>
                <Badge variant="secondary">{run.status}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
