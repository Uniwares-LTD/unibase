"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import { pricingDescription } from "@/lib/ai-pricing";
import type { AiPricing } from "@/lib/config/ai-pricing";
import {
  currentVersion,
  dependenciesCurrent,
  studioOutputSchema,
  reviewSchema,
  workspaceSchema,
  type WorkspaceCommand,
  type WorkspaceView,
} from "@/lib/contracts/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Payload<T> = T extends unknown
  ? Omit<T, "key" | "revision" | "expectedUid">
  : never;
type Action = Payload<WorkspaceCommand>;
type Send = (action: Action) => Promise<boolean>;
type Capability = {
  name: string;
  title: string;
  credits: number;
  pricingKey: string;
  pricing: AiPricing;
  simulated: boolean;
};
export function WorkspaceEditor({
  uid,
  initial,
  capabilities,
}: {
  uid: string;
  initial: WorkspaceView;
  capabilities: Capability[];
}) {
  const [workspace, setWorkspace] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ intent: string; body: WorkspaceCommand } | null>(
    null,
  );
  const path = `/api/workspaces/${initial.id}`;
  async function refresh() {
    try {
      const next = await api(path, workspaceSchema);
      setWorkspace((old) => (next.revision >= old.revision ? next : old));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh workspace.");
    }
  }
  const running = workspace.batches.some((b) =>
    b.items.some((i) =>
      ["queued", "dispatching", "running"].includes(i.status),
    ),
  );
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const interval = setInterval(() => {
      void api(path, workspaceSchema, { signal: controller.signal })
        .then((next) =>
          setWorkspace((old) => (next.revision >= old.revision ? next : old)),
        )
        .catch(() => undefined);
    }, 3000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, [path, running]);
  const send: Send = async (action) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    const intent = JSON.stringify(action);
    const body =
      pending.current?.intent === intent
        ? pending.current.body
        : {
            ...action,
            key: crypto.randomUUID(),
            expectedUid: uid,
            revision: workspace.revision,
          };
    pending.current = { intent, body };
    try {
      const next = await api(path, workspaceSchema, {
        method: "POST",
        body,
        timeoutMs: 120000,
      });
      setWorkspace(next);
      pending.current = null;
      setNotice("Saved.");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "WORKSPACE_CONFLICT")
        pending.current = null;
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Retry the same action or refresh.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link href="/workspaces">All workspaces</Link>
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void send({ action: "pause", paused: !workspace.paused })
          }
        >
          {workspace.paused ? "Resume workflow" : "Pause workflow"}
        </Button>
        <Badge variant="secondary">
          {workspace.paused ? "Paused" : "Active"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Pausing prevents new job admission. Already admitted jobs continue;
        cancel or inspect uncertain jobs in the{" "}
        <Link className="underline" href="/ai">
          AI workspace
        </Link>
        .
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive p-3 text-destructive"
        >
          {error}{" "}
          <span className="block">
            After a version conflict, refresh and review the current content
            before submitting again.
          </span>
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {busy ? "Saving…" : notice}
      </p>
      <Composer
        workspace={workspace}
        capabilities={capabilities}
        send={send}
        busy={busy}
      />
      <section aria-labelledby="decisions-heading" className="space-y-3">
        <h2 id="decisions-heading" className="text-xl font-semibold">
          Decisions
        </h2>
        {!workspace.cards.length && (
          <p className="text-muted-foreground">
            Ask the assistant to generate a question, then select the result to
            answer it here.
          </p>
        )}
        {workspace.cards.map((card) => (
          <QuestionCard key={card.id} card={card} send={send} busy={busy} />
        ))}
      </section>
      <section aria-labelledby="batches-heading" className="space-y-3">
        <h2 id="batches-heading" className="text-xl font-semibold">
          Candidate batches
        </h2>
        {!workspace.batches.length && (
          <p className="text-muted-foreground">
            Generated candidates and their execution status appear here.
          </p>
        )}
        {[...workspace.batches].reverse().map((batch) => (
          <Card key={batch.id}>
            <CardHeader>
              <CardTitle>
                {batch.capability.replace("workspace-", "")} ·{" "}
                {batch.items.length} candidate
                {batch.items.length === 1 ? "" : "s"}
              </CardTitle>
              <CardDescription className="break-words">
                {batch.prompt}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">
                Maximum reserved: {batch.maximumCredits} credits. Each
                successful candidate is charged, including candidates you do not
                select.
              </p>
              {!dependenciesCurrent(workspace, batch.dependencies) && (
                <p className="text-destructive">
                  A source changed. These candidates remain available for
                  inspection but cannot replace current work.
                </p>
              )}
              <div className="grid gap-3 lg:grid-cols-3">
                {batch.items.map((item, index) => (
                  <div
                    key={item.jobId}
                    className="min-w-0 space-y-3 rounded-lg border p-3"
                  >
                    <h3 className="font-medium">
                      Candidate {index + 1}{" "}
                      <Badge variant="secondary">{item.status}</Badge>
                    </h3>
                    {item.error && (
                      <p className="text-sm text-destructive">{item.error}</p>
                    )}
                    <CandidateOutput value={item.output} />
                    {batch.selected === index ? (
                      <p className="font-medium">Selected and saved</p>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          batch.selected !== null ||
                          item.status !== "succeeded" ||
                          !dependenciesCurrent(workspace, batch.dependencies)
                        }
                        onClick={() =>
                          void send({
                            action: "select",
                            batchId: batch.id,
                            index,
                          })
                        }
                      >
                        Select candidate {index + 1}
                      </Button>
                    )}
                    <p className="break-all text-xs text-muted-foreground">
                      Execution: {item.jobId}
                    </p>
                  </div>
                ))}
              </div>
              {batch.selected === null &&
                batch.items.some((i) => i.status === "pending") && (
                  <Button
                    disabled={busy || workspace.paused}
                    variant="outline"
                    onClick={() =>
                      void send({ action: "admit", batchId: batch.id })
                    }
                  >
                    Retry pending admission
                  </Button>
                )}
            </CardContent>
          </Card>
        ))}
      </section>
      <section aria-labelledby="artifacts-heading" className="space-y-4">
        <h2 id="artifacts-heading" className="text-xl font-semibold">
          Artifacts and approvals
        </h2>
        <ArtifactForm send={send} busy={busy} workspace={workspace} />
        {workspace.artifacts.map((artifact) => (
          <ArtifactPanel
            key={`${artifact.id}:${currentVersion(artifact).number}`}
            artifact={artifact}
            workspace={workspace}
            send={send}
            busy={busy}
          />
        ))}
      </section>
      <section aria-labelledby="assets-heading" className="space-y-3">
        <h2 id="assets-heading" className="text-xl font-semibold">
          Private assets and exports
        </h2>
        <Label htmlFor="asset-upload">
          Upload an image (PNG, JPEG or WebP, at most 1 MiB)
        </Label>
        <Input
          id="asset-upload"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            event.target.value = "";
            if (file.size > 1024 * 1024) {
              setError("Use an image no larger than 1 MiB.");
              return;
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            await send({
              action: "upload",
              name: file.name.slice(0, 500),
              base64: btoa(binary),
            });
          }}
        />
        {workspace.assets.map((asset) => (
          <div
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{asset.name}</p>
              <p className="text-sm text-muted-foreground">
                {asset.mime} · {Math.ceil(asset.bytes / 1024)} KiB
              </p>
            </div>
            <Button asChild variant="outline">
              <a href={`/api/workspace-assets/${asset.id}?download`}>
                Download <span className="sr-only">{asset.name}</span>
              </a>
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}

function CandidateOutput({ value }: { value: unknown }) {
  if (!value) return null;
  const composition = studioOutputSchema.safeParse(value);
  if (composition.success)
    return composition.data.type === "draft" ? (
      <div>
        <h4 className="font-medium">{composition.data.draft.title}</h4>
        <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">
          {composition.data.draft.body}
        </p>
      </div>
    ) : (
      <div>
        <h4 className="font-medium">{composition.data.question.title}</h4>
        <p className="text-sm">{composition.data.question.explanation}</p>
      </div>
    );
  const review = reviewSchema.safeParse(value);
  if (review.success)
    return (
      <div className="space-y-2">
        <p>{review.data.summary}</p>
        {review.data.issues.map((issue, i) => (
          <p key={i} className="text-sm">
            <strong>{issue.severity}:</strong> {issue.message}
          </p>
        ))}
      </div>
    );
  return (
    <p className="text-sm">
      Image ready. Select to validate and save it as a private asset.
    </p>
  );
}

function Composer({
  workspace,
  capabilities,
  send,
  busy,
}: {
  workspace: WorkspaceView;
  capabilities: Capability[];
  send: Send;
  busy: boolean;
}) {
  const [name, setName] = useState(capabilities[0]?.name ?? "");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [target, setTarget] = useState("new");
  const [sources, setSources] = useState<string[]>([]);
  const selected = capabilities.find((c) => c.name === name);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate, revise or review</CardTitle>
        <CardDescription>
          AI can return a typed question or a draft. Selection saves the result;
          only you can approve it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!selected ? (
          <p>
            AI is disabled. You can still create artifacts, revise them, approve
            them and manage private assets.
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              await send({
                action: "batch",
                capability: name as
                  "workspace-compose" | "workspace-review" | "workspace-image",
                prompt,
                count: Number(count),
                targetId: target === "new" ? null : target,
                dependencies: sources.map((id) => ({
                  artifactId: id,
                  version: currentVersion(
                    workspace.artifacts.find((a) => a.id === id)!,
                  ).number,
                })),
                pricingKey: selected.pricingKey,
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="capability">Task</Label>
                <Select value={name} onValueChange={setName} disabled={busy}>
                  <SelectTrigger id="capability">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {capabilities.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target">Target artifact</Label>
                <Select
                  value={target}
                  onValueChange={setTarget}
                  disabled={busy}
                >
                  <SelectTrigger id="target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New artifact / question</SelectItem>
                    {workspace.artifacts.map((a) => (
                      <SelectItem value={a.id} key={a.id}>
                        {currentVersion(a).title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-count">Candidates</Label>
                <Select value={count} onValueChange={setCount} disabled={busy}>
                  <SelectTrigger id="candidate-count">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3].map((n) => (
                      <SelectItem value={String(n)} key={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SourcePicker
              workspace={workspace}
              value={sources}
              onChange={setSources}
              disabled={busy}
            />
            <div className="space-y-2">
              <Label htmlFor="prompt">Instructions</Label>
              <Textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                maxLength={10000}
                disabled={busy}
                placeholder="Ask me a question about the draft, create a draft, or review the selected artifact…"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {selected.simulated ? "Simulated provider. " : ""}
              {pricingDescription(selected.pricing)} Reserve up to{" "}
              <strong>{selected.credits * Number(count)} credits</strong> for{" "}
              {count} candidate(s). Successful candidates are charged
              independently; unused reservations are released. Partial admission
              can be retried at the saved price.
            </p>
            <Button
              disabled={
                busy ||
                workspace.paused ||
                (name === "workspace-review" && target === "new")
              }
            >
              Generate candidates
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function SourcePicker({
  workspace,
  value,
  onChange,
  disabled,
  exclude,
}: {
  workspace: WorkspaceView;
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
  exclude?: string;
}) {
  if (!workspace.artifacts.some((a) => a.id !== exclude)) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Source artifacts (optional)
      </legend>
      <div className="flex flex-wrap gap-2">
        {workspace.artifacts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <Button
              type="button"
              key={a.id}
              variant={value.includes(a.id) ? "secondary" : "outline"}
              aria-pressed={value.includes(a.id)}
              disabled={disabled}
              className="h-auto max-w-full whitespace-normal"
              onClick={() =>
                onChange(
                  value.includes(a.id)
                    ? value.filter((id) => id !== a.id)
                    : [...value, a.id],
                )
              }
            >
              {currentVersion(a).title} · v{currentVersion(a).number}
            </Button>
          ))}
      </div>
    </fieldset>
  );
}

function QuestionCard({
  card,
  send,
  busy,
}: {
  card: WorkspaceView["cards"][number];
  send: Send;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const active = card.status === "active";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.question.title}</CardTitle>
        <CardDescription>{card.question.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!active ? (
          <>
            <p className="break-words">
              Saved answer:{" "}
              {Array.isArray(card.answer)
                ? card.answer
                    .map(
                      (a) =>
                        card.question.options.find((o) => o.id === a)?.label ??
                        a,
                    )
                    .join(", ")
                : (card.question.options.find((o) => o.id === card.answer)
                    ?.label ?? card.answer)}
            </p>
            <Badge variant="secondary">{card.status}</Badge>
            {card.status === "answered" && (
              <Button
                className="ml-3"
                variant="outline"
                disabled={busy}
                onClick={() => void send({ action: "reopen", cardId: card.id })}
              >
                Reopen question
              </Button>
            )}
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send({
                action: "answer",
                cardId: card.id,
                value:
                  card.question.kind === "text"
                    ? text
                    : card.question.kind === "single"
                      ? choices[0]
                      : choices,
              });
            }}
          >
            {card.question.kind === "text" ? (
              <>
                <Label htmlFor={card.id}>Your answer</Label>
                <Textarea
                  id={card.id}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  maxLength={4000}
                  disabled={busy}
                />
              </>
            ) : (
              <fieldset>
                <legend className="mb-2 text-sm">
                  {card.question.kind === "multiple"
                    ? "Choose one or more"
                    : "Choose one"}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {card.question.options.map((o) => (
                    <Button
                      key={o.id}
                      type="button"
                      aria-pressed={choices.includes(o.id)}
                      variant={choices.includes(o.id) ? "secondary" : "outline"}
                      disabled={busy}
                      onClick={() =>
                        setChoices(
                          card.question.kind === "single"
                            ? [o.id]
                            : choices.includes(o.id)
                              ? choices.filter((c) => c !== o.id)
                              : [...choices, o.id],
                        )
                      }
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
            <Button
              disabled={
                busy ||
                (card.question.kind === "text" ? !text.trim() : !choices.length)
              }
            >
              Save answer
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ArtifactForm({
  workspace,
  artifact,
  send,
  busy,
}: {
  workspace: WorkspaceView;
  artifact?: WorkspaceView["artifacts"][number];
  send: Send;
  busy: boolean;
}) {
  const version = artifact ? currentVersion(artifact) : null;
  const [title, setTitle] = useState(version?.title ?? "");
  const [body, setBody] = useState(version?.body ?? "");
  const [sources, setSources] = useState(
    version?.dependencies.map((d) => d.artifactId) ?? [],
  );
  const prefix = artifact?.id ?? "new-artifact";
  return (
    <form
      className="space-y-3 rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await send({
            action: "save",
            artifactId: artifact?.id ?? null,
            title,
            body,
            dependencies: sources.map((id) => ({
              artifactId: id,
              version: currentVersion(
                workspace.artifacts.find((a) => a.id === id)!,
              ).number,
            })),
          })
        ) {
          if (!artifact) {
            setTitle("");
            setBody("");
            setSources([]);
          }
        }
      }}
    >
      <h3 className="font-medium">
        {artifact ? "Revise this artifact" : "Write a draft"}
      </h3>
      <Label htmlFor={`${prefix}-title`}>Title</Label>
      <Input
        id={`${prefix}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={500}
        disabled={busy}
      />
      <Label htmlFor={`${prefix}-body`}>Content</Label>
      <Textarea
        id={`${prefix}-body`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
        maxLength={30000}
        disabled={busy}
      />
      <SourcePicker
        workspace={workspace}
        value={sources}
        onChange={setSources}
        exclude={artifact?.id}
        disabled={busy}
      />
      <Button disabled={busy}>
        {artifact ? "Save new version" : "Save draft"}
      </Button>
    </form>
  );
}

function ArtifactPanel({
  workspace,
  artifact,
  send,
  busy,
}: {
  workspace: WorkspaceView;
  artifact: WorkspaceView["artifacts"][number];
  send: Send;
  busy: boolean;
}) {
  const current = currentVersion(artifact);
  const [number, setNumber] = useState(String(current.number));
  const version = artifact.versions.find((v) => v.number === Number(number))!;
  const [reason, setReason] = useState("");
  const reviews = workspace.reviews.filter(
    (r) => r.artifactId === artifact.id && r.version === version.number,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{version.title}</CardTitle>
        <CardDescription>
          Version {version.number} ·{" "}
          {artifact.approval?.version === version.number
            ? "Approved"
            : "Needs human approval"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-2">
          <Label htmlFor={`${artifact.id}-version`}>View version</Label>
          <Select value={number} onValueChange={setNumber}>
            <SelectTrigger id={`${artifact.id}-version`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {artifact.versions.map((v) => (
                <SelectItem key={v.number} value={String(v.number)}>
                  Version {v.number}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {version.body && (
          <p className="max-h-96 overflow-auto whitespace-pre-wrap break-words">
            {version.body}
          </p>
        )}
        {version.assetId && (
          <a
            className="block underline"
            href={`/api/workspace-assets/${version.assetId}`}
            target="_blank"
            rel="noreferrer"
          >
            View private image
          </a>
        )}
        {!dependenciesCurrent(workspace, version.dependencies) && (
          <p className="text-destructive">
            An upstream version changed. Revise this artifact using current
            sources before approval.
          </p>
        )}
        {reviews.map((review) => (
          <div key={review.id} className="rounded-lg border p-3">
            <h4 className="font-medium">Quality review · v{review.version}</h4>
            <CandidateOutput value={review.result} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void send({
                action: "export",
                artifactId: artifact.id,
                version: version.number,
                format: "json",
              })
            }
          >
            Export JSON
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void send({
                action: "export",
                artifactId: artifact.id,
                version: version.number,
                format: "text",
              })
            }
          >
            Export text
          </Button>
        </div>
        {version.number === current.number && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${artifact.id}-reason`}>
                Approval note (required when accepting blocking findings)
              </Label>
              <Textarea
                id={`${artifact.id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
                disabled={busy}
              />
              <Button
                disabled={busy || artifact.approval?.version === current.number}
                onClick={() =>
                  void send({
                    action: "approve",
                    artifactId: artifact.id,
                    version: current.number,
                    reason,
                  })
                }
              >
                Approve version {current.number}
              </Button>
            </div>
            {!current.assetId && (
              <details>
                <summary className="cursor-pointer rounded-md py-2 font-medium focus-visible:outline-2">
                  Edit and save a new version
                </summary>
                <ArtifactForm
                  workspace={workspace}
                  artifact={artifact}
                  send={send}
                  busy={busy}
                />
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
