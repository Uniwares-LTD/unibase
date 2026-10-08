"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Conversation } from "./conversation";
import { SourcePicker } from "./source-picker";
import { WorkflowPanel } from "./workflow-panel";
import { QualityPanel } from "./quality-panel";
import { PrivateUpload } from "./private-upload";
import { ImageReferencePicker } from "./image-reference-picker";
import { ExportPanel } from "./export-panel";
import type { ExportJobView, ExportOption } from "@/lib/contracts/export";
import { MONGO_ASSET_LIMIT } from "@/lib/config/assets";
import type { WorkflowRunView } from "@/lib/contracts/workflow";
import { RegisteredCard } from "./registered-card";
import {
  RegisteredArtifactView,
  RegisteredArtifactEditor,
} from "./registered-artifact";
import { legacyArtifactContent } from "@/lib/creation/artifacts";
import { api, ApiError } from "@/lib/client/api";
import { pricingDescription } from "@/lib/ai-pricing";
import type { AiPricing } from "@/lib/config/ai-pricing";
import type { ProfileSummary } from "@/lib/contracts/execution-profile";
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
export type Capability = {
  name: string;
  title: string;
  credits: number;
  pricingKey: string;
  pricing: AiPricing;
  simulated: boolean;
  defaultAvailable?: boolean;
};
export function WorkspaceEditor({
  uid,
  initial,
  capabilities,
  profiles = [],
  initialWorkflows = [],
  maxImageBytes = MONGO_ASSET_LIMIT,
  initialExports = [],
  exportRenderers = [],
  maxExportBytes = MONGO_ASSET_LIMIT,
}: {
  uid: string;
  initial: WorkspaceView;
  capabilities: Capability[];
  profiles?: ProfileSummary[];
  initialWorkflows?: WorkflowRunView[];
  maxImageBytes?: number;
  initialExports?: ExportJobView[];
  exportRenderers?: ExportOption[];
  maxExportBytes?: number;
}) {
  const [workspace, setWorkspace] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ intent: string; body: WorkspaceCommand } | null>(
    null,
  );
  const path = `/api/workspaces/${initial.id}`;
  const refresh = useCallback(async () => {
    try {
      const next = await api(path, workspaceSchema);
      setWorkspace((old) => (next.revision >= old.revision ? next : old));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh workspace.");
    }
  }, [path]);
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
          disabled={busy || Boolean(workspace.archivedAt)}
          onClick={() =>
            void send({ action: "pause", paused: !workspace.paused })
          }
        >
          {workspace.paused ? "Resume workspace" : "Pause workspace"}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void send({ action: "archive", archived: !workspace.archivedAt })
          }
        >
          {workspace.archivedAt ? "Restore workspace" : "Archive workspace"}
        </Button>
        <Badge variant="secondary">
          {workspace.archivedAt
            ? "Archived"
            : workspace.paused
              ? "Paused"
              : "Active"}
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
      {workspace.archivedAt && (
        <p role="status">
          Archived workspaces are read-only and eligible for administrator
          cleanup after the selected retention period. Restore to edit; then
          resume when ready to admit new work.
        </p>
      )}
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
      <fieldset
        disabled={Boolean(workspace.archivedAt)}
        className="min-w-0 space-y-6"
      >
        <legend className="sr-only">Workspace content</legend>
        <Conversation
          workspace={workspace}
          busy={busy}
          onMessage={(text) => send({ action: "message", text })}
        />
        <Composer
          workspace={workspace}
          capabilities={capabilities}
          profiles={profiles}
          send={send}
          busy={busy}
        />
        <WorkflowPanel
          uid={uid}
          workspace={workspace}
          initial={initialWorkflows}
          capabilities={capabilities}
          profiles={profiles}
          onChange={refresh}
          disabled={busy}
        />
        <section aria-labelledby="decisions-heading" className="space-y-3">
          <h2 id="decisions-heading" className="text-xl font-semibold">
            Decisions
          </h2>
          {!workspace.cards.length && !workspace.uiCards.length && (
            <p className="text-muted-foreground">
              Ask the assistant to generate a question, then select the result
              to answer it here.
            </p>
          )}
          {workspace.cards.map((card) => (
            <QuestionCard key={card.id} card={card} send={send} busy={busy} />
          ))}
          {workspace.uiCards.map((card) => (
            <RegisteredCard
              key={card.id}
              card={card}
              disabled={busy}
              allowedAssetIds={workspace.assets
                .filter((a) => a.mime.startsWith("image/"))
                .map((a) => a.id)}
              onRespond={(cardAction, value) =>
                void send({
                  action: "respond-card",
                  cardId: card.id,
                  cardAction,
                  value,
                })
              }
              onReopen={() =>
                void send({ action: "reopen-card", cardId: card.id })
              }
            />
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
                  successful candidate is charged, including candidates you do
                  not select.
                </p>
                {batch.capability === "workspace-image" && (
                  <p className="text-sm">
                    {batch.editAssetId ? "Image edit" : "Image generation"} ·{" "}
                    {batch.referenceAssetIds?.length ?? 0} reference images
                  </p>
                )}
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
                      {item.profile && (
                        <p className="text-sm text-muted-foreground">
                          {item.profile.name} · revision {item.profile.revision}
                        </p>
                      )}
                      {item.error && (
                        <p className="text-sm text-destructive">{item.error}</p>
                      )}
                      <CandidateOutput
                        value={item.output}
                        allowedAssetIds={workspace.assets
                          .filter((asset) => asset.mime.startsWith("image/"))
                          .map((asset) => asset.id)}
                      />
                      {batch.capability === "workspace-image" &&
                        item.status === "succeeded" &&
                        Boolean(item.output) && (
                          <Image
                            unoptimized
                            src={`/api/workspaces/${workspace.id}/candidates/${item.jobId}/image`}
                            alt={`Candidate ${index + 1} preview`}
                            width={512}
                            height={512}
                            className="h-auto max-h-80 w-full rounded-md object-contain"
                          />
                        )}
                      {batch.selected === index ? (
                        <p className="font-medium">Selected and saved</p>
                      ) : (
                        <Button
                          variant="outline"
                          disabled={
                            busy ||
                            batch.selected !== null ||
                            item.status !== "succeeded" ||
                            !item.output ||
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
                      {item.retrySafe &&
                        batch.selected === null &&
                        !workspace.batches.some(
                          (b) => b.retryOf === item.jobId,
                        ) && (
                          <NewAttempt
                            capability={capabilities.find(
                              (c) => c.name === batch.capability,
                            )}
                            batchId={batch.id}
                            index={index}
                            disabled={busy || workspace.paused}
                            send={send}
                          />
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
              uid={uid}
              capabilities={capabilities}
              profiles={profiles}
              onChange={refresh}
            />
          ))}
        </section>
        <section aria-labelledby="assets-heading" className="space-y-3">
          <h2 id="assets-heading" className="text-xl font-semibold">
            Private assets and exports
          </h2>
          <PrivateUpload
            uid={uid}
            workspaceId={workspace.id}
            revision={workspace.revision}
            limit={maxImageBytes}
            disabled={busy}
            onBusy={setBusy}
            onSaved={(next) =>
              setWorkspace((old) =>
                next.revision >= old.revision ? next : old,
              )
            }
            onConflict={refresh}
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
        <ExportPanel
          uid={uid}
          workspace={workspace}
          initial={initialExports}
          options={exportRenderers}
          maxBytes={maxExportBytes}
          disabled={busy}
          onChange={refresh}
        />
      </fieldset>
    </div>
  );
}

function NewAttempt({
  capability,
  batchId,
  index,
  disabled,
  send,
}: {
  capability?: Capability;
  batchId: string;
  index: number;
  disabled: boolean;
  send: Send;
}) {
  if (!capability) return null;
  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={() =>
        void send({
          action: "retry-candidate",
          batchId,
          index,
          pricingKey: capability.pricingKey,
        })
      }
    >
      New attempt · reserve up to {capability.credits} credits
    </Button>
  );
}

function CandidateOutput({
  value,
  allowedAssetIds = [],
}: {
  value: unknown;
  allowedAssetIds?: string[];
}) {
  if (!value) return null;
  const composition = studioOutputSchema.safeParse(value);
  if (composition.success && composition.data.type === "card")
    return (
      <RegisteredCard
        card={{
          id: "candidate",
          content: composition.data.card,
          status: "active",
          response: null,
          responseAction: null,
          createdAt: "",
          answeredAt: null,
          sourceJobId: null,
        }}
        disabled
        allowedAssetIds={allowedAssetIds}
        onRespond={() => undefined}
      />
    );
  if (composition.success && composition.data.type === "artifact")
    return (
      <RegisteredArtifactView
        content={composition.data.artifact}
        allowedAssetIds={allowedAssetIds}
      />
    );
  if (
    composition.success &&
    (composition.data.type === "draft" || composition.data.type === "question")
  )
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
  profiles,
  send,
  busy,
}: {
  workspace: WorkspaceView;
  capabilities: Capability[];
  profiles: ProfileSummary[];
  send: Send;
  busy: boolean;
}) {
  const [name, setName] = useState(capabilities[0]?.name ?? "");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [target, setTarget] = useState("new");
  const [sources, setSources] = useState<string[]>([]);
  const [imageReferences, setImageReferences] = useState<string[]>([]);
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const selected = capabilities.find((c) => c.name === name);
  const eligible = profiles.filter((p) => p.capability === name);
  const profileAt = (index: number) =>
    eligible.find((p) => p.id === profileIds[index]) ??
    (selected?.defaultAvailable === false ? eligible[0] : undefined);
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
                ...(name === "workspace-image"
                  ? { referenceAssetIds: imageReferences }
                  : {}),
                capability: name as
                  "workspace-compose" | "workspace-review" | "workspace-image",
                prompt,
                count: Number(count),
                profiles: Array.from({ length: Number(count) }, (_, index) => {
                  const profile = profileAt(index);
                  return profile
                    ? { id: profile.id, revision: profile.revision }
                    : null;
                }),
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
                <Select
                  value={name}
                  onValueChange={(value) => {
                    setName(value);
                    setProfileIds([]);
                    setTarget("new");
                    setImageReferences([]);
                  }}
                  disabled={busy}
                >
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
                    {workspace.artifacts
                      .filter(
                        (a) =>
                          name !== "workspace-image" ||
                          currentVersion(a).assetId,
                      )
                      .map((a) => (
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
            {name === "workspace-image" && (
              <>
                <p className="text-sm">
                  {target === "new"
                    ? "Generate a new image using your prompt and optional references."
                    : "Edit the selected image. Selecting a result saves a new version; the original remains in history."}
                </p>
                <ImageReferencePicker
                  assets={workspace.assets}
                  value={imageReferences}
                  onChange={setImageReferences}
                  disabled={busy}
                />
              </>
            )}
            {eligible.length > 0 && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  Execution profiles
                </legend>
                <p className="text-sm text-muted-foreground">
                  Compare different reusable instructions or provider
                  configurations in one batch.
                </p>
                {Array.from({ length: Number(count) }, (_, index) => {
                  const profile = profileAt(index);
                  return (
                    <div key={index} className="space-y-2">
                      <Label htmlFor={`candidate-profile-${index}`}>
                        Candidate {index + 1} profile
                      </Label>
                      <Select
                        value={profile?.id ?? "default"}
                        onValueChange={(value) =>
                          setProfileIds((old) =>
                            Array.from({ length: Number(count) }, (_, i) =>
                              i === index ? value : (old[i] ?? "default"),
                            ),
                          )
                        }
                        disabled={busy}
                      >
                        <SelectTrigger id={`candidate-profile-${index}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {selected.defaultAvailable !== false && (
                            <SelectItem value="default">
                              Task default
                            </SelectItem>
                          )}
                          {eligible.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · revision {p.revision}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {profile && (
                        <p className="text-sm text-muted-foreground">
                          {profile.description}
                          {profile.requiresSource
                            ? name === "workspace-image"
                              ? " Requires a source artifact or image reference."
                              : " Requires a source artifact."
                            : ""}
                        </p>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            )}
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
                (name === "workspace-review" && target === "new") ||
                (sources.length === 0 &&
                  imageReferences.length === 0 &&
                  target === "new" &&
                  Array.from({ length: Number(count) }, (_, index) =>
                    profileAt(index),
                  ).some((p) => p?.requiresSource))
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
  const [sources, setSources] = useState(
    version?.dependencies.map((d) => d.artifactId) ?? [],
  );
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">
        {artifact ? "Revise this artifact" : "Create an artifact"}
      </h3>
      <SourcePicker
        workspace={workspace}
        value={sources}
        onChange={setSources}
        exclude={artifact?.id}
        disabled={busy}
      />
      <RegisteredArtifactEditor
        initial={version ? legacyArtifactContent(version) : undefined}
        assets={workspace.assets}
        disabled={busy}
        onSave={async (content) => {
          const saved = await send({
            action: "save-content",
            artifactId: artifact?.id ?? null,
            content,
            dependencies: sources.map((id) => ({
              artifactId: id,
              version: currentVersion(
                workspace.artifacts.find((a) => a.id === id)!,
              ).number,
            })),
          });
          if (saved && !artifact) setSources([]);
          return saved;
        }}
      />
    </div>
  );
}

function ArtifactPanel({
  workspace,
  artifact,
  send,
  busy,
  uid,
  capabilities,
  profiles,
  onChange,
}: {
  workspace: WorkspaceView;
  artifact: WorkspaceView["artifacts"][number];
  send: Send;
  busy: boolean;
  uid: string;
  capabilities: Capability[];
  profiles: ProfileSummary[];
  onChange: () => Promise<void>;
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
        <RegisteredArtifactView
          content={legacyArtifactContent(version)}
          allowedAssetIds={workspace.assets.map((a) => a.id)}
        />
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
        <QualityPanel
          uid={uid}
          workspace={workspace}
          artifact={artifact}
          capabilities={capabilities}
          profiles={profiles}
          disabled={busy}
          onChange={onChange}
          onIssue={(issueId, resolution, reason) =>
            send({ action: "quality-issue", issueId, resolution, reason })
          }
        />
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
            {
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
            }
          </>
        )}
      </CardContent>
    </Card>
  );
}
