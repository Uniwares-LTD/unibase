"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import {
  exportJobSchema,
  exportListSchema,
  type ExportJobView,
  type ExportOption,
} from "@/lib/contracts/export";
import { currentVersion, type WorkspaceView } from "@/lib/contracts/workspace";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Source = { artifactId: string; version: number };
type RequestBody = {
  key: string;
  expectedUid: string;
  revision: number;
  format: "pdf" | "zip";
  renderer: { type: string; version: number };
  sources: Source[];
};
const signature = (jobs: ExportJobView[]) =>
  jobs.map((job) => `${job.id}:${job.status}`).join("|");
export function ExportPanel({
  uid,
  workspace,
  initial,
  options,
  maxBytes,
  disabled,
  onChange,
}: {
  uid: string;
  workspace: WorkspaceView;
  initial: ExportJobView[];
  options: ExportOption[];
  maxBytes: number;
  disabled: boolean;
  onChange: () => Promise<void>;
}) {
  const [jobs, setJobs] = useState(initial);
  const [sources, setSources] = useState<Source[]>([]);
  const [renderer, setRenderer] = useState(
    options[0] ? `${options[0].type}:${options[0].version}` : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<{ intent: string; body: RequestBody } | null>(null);
  const last = useRef(signature(initial));
  const path = `/api/workspaces/${workspace.id}/exports`;
  const accept = useCallback(
    (next: ExportJobView[]) => {
      setJobs((previous) =>
        next.map((job) => {
          const old = previous.find((item) => item.id === job.id);
          return old &&
            (old.revision > job.revision ||
              (old.revision === job.revision && old.updatedAt > job.updatedAt))
            ? old
            : job;
        }),
      );
      const changed = signature(next);
      if (changed !== last.current) {
        last.current = changed;
        void onChange();
      }
    },
    [onChange],
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      accept((await api(path, exportListSchema, { signal })).jobs);
    },
    [path, accept],
  );
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const timer = setInterval(async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        await refresh(controller.signal);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Could not refresh exports.",
          );
      } finally {
        loading = false;
      }
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh]);
  const selected = options.find(
    (item) => `${item.type}:${item.version}` === renderer,
  );
  async function start() {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const intent = JSON.stringify({ renderer, sources });
    const body =
      pending.current?.intent === intent
        ? pending.current.body
        : {
            key: crypto.randomUUID(),
            expectedUid: uid,
            revision: workspace.revision,
            format: selected.format,
            renderer: { type: selected.type, version: selected.version },
            sources,
          };
    pending.current = { intent, body };
    try {
      const job = await api(path, exportJobSchema, { method: "POST", body });
      pending.current = null;
      accept([job, ...jobs.filter((item) => item.id !== job.id)]);
      setNotice("Export queued. You can leave this page while it runs.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXPORT_CONFLICT") {
        pending.current = null;
        await onChange();
      }
      setError(
        e instanceof Error
          ? e.message
          : "Could not queue export. Retry the same selection.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function cancel(job: ExportJobView) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await api(`${path}/${job.id}/cancel`, exportJobSchema, {
        method: "POST",
        body: { expectedUid: uid, revision: job.revision },
      });
      accept(jobs.map((item) => (item.id === next.id ? next : item)));
      setNotice("Export cancelled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel export.");
      await refresh().catch(() => undefined);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="exports-heading" className="space-y-4">
      <h2 id="exports-heading" className="text-xl font-semibold">
        Export jobs
      </h2>
      <p className="text-sm text-muted-foreground">
        Export saved artifact versions in your selection order. Exports use no
        AI credits. Files remain private and are limited to{" "}
        {maxBytes / 1024 / 1024} MiB. Draft and approved content can be
        exported; approval evidence is captured when queued.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <fieldset
        disabled={
          disabled || busy || workspace.paused || !!workspace.archivedAt
        }
        className="space-y-4"
      >
        <legend className="font-medium">
          Choose up to 20 artifact versions
        </legend>
        {!workspace.artifacts.length && (
          <p className="text-sm">Save an artifact to create an export.</p>
        )}
        {workspace.artifacts.map((artifact) => {
          const source = sources.find(
            (item) => item.artifactId === artifact.id,
          );
          return (
            <div
              key={artifact.id}
              className="flex flex-wrap items-center gap-3"
            >
              <Label className="min-w-0 flex-1 break-words">
                <Checkbox
                  checked={!!source}
                  disabled={!source && sources.length >= 20}
                  onCheckedChange={(checked) =>
                    setSources((old) =>
                      checked === true
                        ? [
                            ...old,
                            {
                              artifactId: artifact.id,
                              version: currentVersion(artifact).number,
                            },
                          ]
                        : old.filter((item) => item.artifactId !== artifact.id),
                    )
                  }
                />
                {currentVersion(artifact).title}
              </Label>
              {source && (
                <Select
                  value={String(source.version)}
                  onValueChange={(value) =>
                    setSources((old) =>
                      old.map((item) =>
                        item.artifactId === artifact.id
                          ? { ...item, version: Number(value) }
                          : item,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={`Export version of ${currentVersion(artifact).title}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {artifact.versions.map((version) => (
                      <SelectItem
                        key={version.number}
                        value={String(version.number)}
                      >
                        Version {version.number}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
        <div className="space-y-2">
          <Label htmlFor="export-renderer">Export format</Label>
          <Select value={renderer} onValueChange={setRenderer}>
            <SelectTrigger id="export-renderer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={`${option.type}:${option.version}`}
                  value={`${option.type}:${option.version}`}
                >
                  {option.label} ({option.format.toUpperCase()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          disabled={!selected || !sources.length}
          onClick={() => void start()}
        >
          Queue export
        </Button>
      </fieldset>
      {jobs.map((job) => (
        <Card key={job.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {job.format.toUpperCase()} export · {job.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {job.sources.length} version(s) ·{" "}
              {job.createdAt.replace("T", " ").replace("Z", " UTC")}
            </p>
            {["queued", "rendering"].includes(job.status) && (
              <>
                <Progress
                  value={job.progress}
                  aria-label={`${job.format.toUpperCase()} export progress`}
                />
                <p className="text-sm">
                  {job.progress}% · Closing this page does not cancel the
                  export.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled || busy}
                  onClick={() => void cancel(job)}
                >
                  Cancel export
                </Button>
              </>
            )}
            {job.error && <p className="text-sm">{job.error}</p>}
            {job.status === "succeeded" && job.assetId && (
              <Button variant="outline" asChild>
                <a href={`/api/workspace-assets/${job.assetId}?download`}>
                  Download {job.format.toUpperCase()}
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
