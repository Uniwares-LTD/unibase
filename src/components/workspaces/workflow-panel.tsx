"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api, ApiError } from "@/lib/client/api";
import { workflowTemplates } from "@/lib/creation/workflows";
import {
  workflowRunSchema,
  type WorkflowAction,
  type WorkflowRunView,
  type WorkflowStart,
} from "@/lib/contracts/workflow";
import { currentVersion, type WorkspaceView } from "@/lib/contracts/workspace";
import type { ProfileSummary } from "@/lib/contracts/execution-profile";
import type { Capability } from "./workspace-editor";
import { SourcePicker } from "./source-picker";
import { RegisteredCard } from "./registered-card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const templates = workflowTemplates.list();
const templateKey = (item: { type: string; version: number }) =>
  `${item.type}:${item.version}`;
const runListSchema = z.array(workflowRunSchema);
const signature = (runs: WorkflowRunView[]) =>
  runs.map((run) => `${run.id}:${run.revision}`).join("|");

export function WorkflowPanel({
  uid,
  workspace,
  initial,
  capabilities,
  profiles,
  onChange,
  disabled,
}: {
  uid: string;
  workspace: WorkspaceView;
  initial: WorkflowRunView[];
  capabilities: Capability[];
  profiles: ProfileSummary[];
  onChange: () => Promise<void>;
  disabled: boolean;
}) {
  const [runs, setRuns] = useState(initial);
  const [template, setTemplate] = useState(templateKey(templates[0]));
  const [prompt, setPrompt] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<
    Record<string, string>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const latestSignature = useRef(signature(initial));
  const pending = useRef<{
    intent: string;
    path: string;
    body: WorkflowStart | WorkflowAction;
  } | null>(null);
  const path = `/api/workspaces/${workspace.id}/workflows`;
  const accept = useCallback(
    (next: WorkflowRunView[]) => {
      setRuns((old) =>
        next.map((run) => {
          const previous = old.find((item) => item.id === run.id);
          return previous && previous.revision > run.revision ? previous : run;
        }),
      );
      const nextSignature = signature(next);
      if (nextSignature !== latestSignature.current) {
        latestSignature.current = nextSignature;
        void onChange();
      }
    },
    [onChange],
  );
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    // Poll even an empty list: another tab can start a run in this workspace.
    const timer = setInterval(async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        accept(await api(path, runListSchema, { signal: controller.signal }));
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not refresh workflows.",
          );
      } finally {
        loading = false;
      }
    }, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [path, accept]);
  const definition = templates.find(
    (item) => templateKey(item) === template,
  )!.definition;
  const taskSteps = definition.steps.filter((step) => step.kind === "task");
  const maximum = taskSteps.reduce(
    (total, step) =>
      total +
      (capabilities.find((c) => c.name === step.capability)?.credits ?? 0) *
        step.count,
    0,
  );
  const unavailable = taskSteps.some((step) => {
    const capability = capabilities.find((c) => c.name === step.capability);
    return (
      !capability ||
      (capability.defaultAvailable === false && !selectedProfiles[step.id])
    );
  });
  async function send(target: string, body: WorkflowStart | WorkflowAction) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    // Preserve the complete accepted payload after an ambiguous transport failure.
    const intent = JSON.stringify({
      target,
      ...body,
      key: undefined,
      revision: undefined,
    });
    const request =
      pending.current?.intent === intent
        ? pending.current
        : { intent, path: target, body };
    pending.current = request;
    try {
      const next = await api(request.path, workflowRunSchema, {
        method: "POST",
        body: request.body,
      });
      pending.current = null;
      setRuns((old) =>
        [next, ...old.filter((run) => run.id !== next.id)].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      );
      await onChange();
      setNotice("Workflow saved.");
      return true;
    } catch (e) {
      if (
        e instanceof ApiError &&
        ["WORKFLOW_CONFLICT", "WORKSPACE_CONFLICT"].includes(e.code)
      ) {
        pending.current = null;
        await Promise.allSettled([
          api(path, runListSchema).then(accept),
          onChange(),
        ]);
      }
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Retry the same action.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function start() {
    const body: WorkflowStart = {
      key: crypto.randomUUID(),
      expectedUid: uid,
      revision: workspace.revision,
      definition: {
        ...definition,
        steps: definition.steps.map((step) => {
          if (step.kind !== "task") return step;
          const profile = profiles.find(
            (p) => p.id === selectedProfiles[step.id],
          );
          return {
            ...step,
            profile: profile
              ? { id: profile.id, revision: profile.revision }
              : null,
          };
        }),
      },
      prompt: prompt.trim(),
      targetId: null,
      sources: workspace.artifacts
        .filter((a) => sources.includes(a.id))
        .map((a) => ({ artifactId: a.id, version: currentVersion(a).number })),
      pricingKeys: Object.fromEntries(
        capabilities.map((c) => [c.name, c.pricingKey]),
      ),
      maximumCredits: maximum,
    };
    if (await send(path, body)) setPrompt("");
  }
  function act(
    run: WorkflowRunView,
    action: WorkflowAction["action"],
    stepId?: string,
  ) {
    void send(`${path}/${run.id}`, {
      key: crypto.randomUUID(),
      expectedUid: uid,
      revision: run.revision,
      action,
      ...(stepId ? { stepId } : {}),
    });
  }
  const locked = disabled || busy;
  return (
    <section aria-labelledby="workflows-heading" className="space-y-4">
      <h2 id="workflows-heading" className="text-xl font-semibold">
        Workflows
      </h2>
      <Card>
        <CardHeader>
          <CardTitle>Start a workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void start();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="workflow-template">Workflow template</Label>
              <Select
                value={template}
                disabled={locked}
                onValueChange={(value) => {
                  setTemplate(value);
                  setSelectedProfiles({});
                }}
              >
                <SelectTrigger id="workflow-template" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem
                      key={templateKey(item)}
                      value={templateKey(item)}
                    >
                      {item.definition.title} · v{item.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ol className="space-y-3" aria-label="Planned workflow steps">
              {definition.steps.map((step) => (
                <li key={step.id} className="rounded-md border p-3 space-y-2">
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {step.dependsOn.length
                      ? `After: ${step.dependsOn.map((id) => definition.steps.find((s) => s.id === id)!.title).join(", ")}. `
                      : "Ready at start. "}
                    {step.kind === "checkpoint"
                      ? "Waits for your approval and confirmation."
                      : `${step.count} candidate${step.count > 1 ? "s" : ""}; ${step.selection === "human" ? "you choose the result" : "result is imported automatically"}.`}
                  </p>
                  {step.kind === "task" && (
                    <div className="space-y-1">
                      <Label htmlFor={`workflow-profile-${step.id}`}>
                        {step.title} profile
                      </Label>
                      <Select
                        disabled={locked}
                        value={selectedProfiles[step.id] || "default"}
                        onValueChange={(value) =>
                          setSelectedProfiles((old) => ({
                            ...old,
                            [step.id]: value === "default" ? "" : value,
                          }))
                        }
                      >
                        <SelectTrigger
                          id={`workflow-profile-${step.id}`}
                          className="w-full"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="default"
                            disabled={
                              capabilities.find(
                                (c) => c.name === step.capability,
                              )?.defaultAvailable === false
                            }
                          >
                            Task default
                          </SelectItem>
                          {profiles
                            .filter(
                              (p) =>
                                p.capability === step.capability &&
                                (!p.requiresSource ||
                                  sources.length > 0 ||
                                  step.dependsOn.length > 0),
                            )
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} · revision {p.revision}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <SourcePicker
              workspace={workspace}
              value={sources}
              onChange={setSources}
              disabled={locked}
            />
            <div className="space-y-2">
              <Label htmlFor="workflow-prompt">Workflow instructions</Label>
              <Textarea
                id="workflow-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                maxLength={6000}
                required
                disabled={locked}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Up to {maximum} credits across all planned candidates, including
              unselected results. Credits are reserved per step as it starts.
              New attempts require separate consent.{" "}
              {capabilities.some((c) => c.simulated)
                ? "Uses simulated AI in this environment."
                : ""}
            </p>
            {unavailable && (
              <p className="text-sm">
                A task or profile is unavailable. Configure the required
                capabilities before starting.
              </p>
            )}
            <Button
              disabled={
                locked ||
                workspace.paused ||
                unavailable ||
                !prompt.trim() ||
                runs.length >= 20
              }
            >
              Start workflow
            </Button>
          </form>
        </CardContent>
      </Card>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {busy ? "Saving workflow…" : notice}
      </p>
      {runs.map((run) => (
        <article
          key={run.id}
          className="space-y-3 rounded-lg border p-4"
          aria-label={`${run.title} run`}
        >
          <RegisteredCard
            card={{
              id: run.id,
              content: {
                type: "progress",
                version: 1,
                data: {
                  title: run.title,
                  completed: run.steps.filter((s) => s.status === "completed")
                    .length,
                  total: run.steps.length,
                  label: run.status,
                },
              },
              status: "active",
              response: null,
              responseAction: null,
              createdAt: run.createdAt,
              answeredAt: null,
              sourceJobId: null,
            }}
            disabled
            onRespond={() => undefined}
          />
          <p className="text-sm text-muted-foreground">
            Started {run.createdAt.replace("T", " ").slice(0, 19)} UTC · planned
            maximum {run.maximumCredits} credits
          </p>
          {!["cancelled", "completed"].includes(run.status) && (
            <div className="flex flex-wrap gap-2">
              {run.status === "active" && (
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => act(run, "pause")}
                >
                  Pause run
                </Button>
              )}
              {(run.status === "paused" ||
                run.steps.some((step) => step.status === "blocked")) && (
                <Button
                  disabled={locked || workspace.paused}
                  onClick={() => act(run, "resume")}
                >
                  Resume run
                </Button>
              )}
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => act(run, "cancel")}
              >
                Cancel remaining work
              </Button>
            </div>
          )}
          <ol className="space-y-3">
            {run.steps.map((step) => (
              <li key={step.id} className="space-y-2 border-t pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{step.title}</span>
                  <Badge variant="secondary">
                    {step.status.replaceAll("-", " ")}
                  </Badge>
                </div>
                {step.error && <p className="text-sm">{step.error}</p>}
                {step.batchId && (
                  <a href="#batches-heading" className="text-sm underline">
                    View candidates and recovery options
                  </a>
                )}
                {!!step.artifacts.length && (
                  <p className="text-sm">
                    <a href="#artifacts-heading" className="underline">
                      Review source artifacts and approvals
                    </a>
                  </p>
                )}
                {step.kind === "checkpoint" &&
                  step.status === "awaiting-human" &&
                  run.status === "active" && (
                    <Button
                      disabled={locked || workspace.paused}
                      onClick={() => act(run, "checkpoint", step.id)}
                    >
                      Continue: {step.title}
                    </Button>
                  )}
                {step.checkpointAt && (
                  <p className="text-sm text-muted-foreground">
                    Confirmed {step.checkpointAt.replace("T", " ").slice(0, 19)}{" "}
                    UTC
                  </p>
                )}
              </li>
            ))}
          </ol>
        </article>
      ))}
      {!!runs.length && (
        <p className="text-sm text-muted-foreground">
          Pausing stops future steps; admitted jobs can finish. Cancellation
          requests a stop for unfinished jobs. Uncertain provider outcomes still
          require administrator review.
        </p>
      )}
    </section>
  );
}
