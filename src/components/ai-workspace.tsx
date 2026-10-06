"use client";
import Link from "next/link";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type { AiPricing } from "@/lib/config/ai-pricing";
import { pricingDescription } from "@/lib/ai-pricing";
import { api, ApiError } from "@/lib/client/api";
import {
  aiFileViewSchema,
  aiJobViewSchema,
  type AiJobView,
} from "@/lib/contracts/ai";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Notice } from "./page-patterns";

type Capability = {
  name: string;
  title: string;
  credits: number;
  pricing: AiPricing;
  pricingKey: string;
  kind: "workflow" | "chat";
  acceptsFile: boolean;
  simulated: boolean;
};
const active = ["queued", "dispatching", "running", "paused", "unknown"];

export function AiWorkspace({
  uid,
  capabilities,
  initialJobs,
  initialKey,
}: {
  uid: string;
  capabilities: Capability[];
  initialJobs: AiJobView[];
  initialKey: string;
}) {
  const id = useId();
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState(
    capabilities.find((item) => item.name === "assistant-text")?.name ??
      capabilities[0]?.name ??
      "",
  );
  const [prompt, setPrompt] = useState("");
  const [conversation, setConversation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const requestKey = useRef(initialKey);
  const current = capabilities.find((item) => item.name === selected);
  const hasActive = jobs.some((job) => active.includes(job.status));
  const regenerateKey = () => {
    requestKey.current = crypto.randomUUID();
  };
  async function refresh() {
    setJobs(await api("/api/ai/jobs", z.array(aiJobViewSchema)));
  }
  function report(error: unknown) {
    setMessage(
      error instanceof ApiError
        ? error.message
        : "Could not confirm the request. Refresh the execution list before retrying.",
    );
  }
  useEffect(() => {
    if (!hasActive) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void api("/api/ai/jobs", z.array(aiJobViewSchema), {
        signal: controller.signal,
      })
        .then(setJobs)
        .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [hasActive]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current) return;
    setBusy(true);
    setMessage("");
    const key = requestKey.current;
    try {
      const inputs: Record<string, string> = { prompt };
      if (current.acceptsFile) {
        const file = fileInput.current?.files?.[0];
        if (!file) {
          setMessage("Choose a document or image first.");
          return;
        }
        const form = new FormData();
        form.set("file", file);
        form.set("capability", selected);
        form.set("key", key);
        form.set("expectedUid", uid);
        const uploaded = await api("/api/ai/files", aiFileViewSchema, {
          method: "POST",
          body: form,
          timeoutMs: 120000,
        });
        if (uploaded.status !== "ready") {
          setMessage(
            "The upload has not been confirmed. Reusing this request will not upload it again.",
          );
          return;
        }
        inputs.fileId = uploaded.id;
      }
      const job = await api("/api/ai/jobs", aiJobViewSchema, {
        method: "POST",
        body: {
          key,
          capability: selected,
          inputs,
          expectedUid: uid,
          pricingKey: current.pricingKey,
          ...(conversation && current.kind === "chat"
            ? { conversationId: conversation }
            : {}),
        },
      });
      setJobs((previous) =>
        [job, ...previous.filter((item) => item.id !== job.id)].slice(0, 25),
      );
      if (current.kind === "chat") setConversation(job.conversationId);
      regenerateKey();
      setPrompt("");
      setMessage("Execution queued. You can leave this page and return later.");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(job: AiJobView) {
    setBusy(true);
    try {
      await api(`/api/ai/jobs/${job.id}`, aiJobViewSchema, {
        method: "DELETE",
      });
      await refresh();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {current?.simulated && (
        <Notice title="Local simulation">
          Replies are fixtures. No external model is called. Application credits
          still exercise the real reservation and ledger flow.
        </Notice>
      )}
      {capabilities.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Start an AI task</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`${id}-capability`}>Capability</Label>
                <Select
                  value={selected}
                  disabled={busy}
                  onValueChange={(value) => {
                    setSelected(value);
                    setConversation(null);
                    regenerateKey();
                  }}
                >
                  <SelectTrigger id={`${id}-capability`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {capabilities.map((item) => (
                      <SelectItem key={item.name} value={item.name}>
                        {item.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-prompt`}>Your request</Label>
                <Textarea
                  id={`${id}-prompt`}
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    regenerateKey();
                  }}
                  required
                  maxLength={10000}
                  rows={4}
                  disabled={busy}
                />
              </div>
              {current?.acceptsFile && (
                <div className="space-y-2">
                  <Label htmlFor={`${id}-file`}>
                    Document or image (up to 20 MiB)
                  </Label>
                  <Input
                    ref={fileInput}
                    id={`${id}-file`}
                    type="file"
                    accept=".txt,.pdf,.png,.jpg,.jpeg,.webp"
                    required
                    disabled={busy}
                    onChange={regenerateKey}
                  />
                </div>
              )}
              {conversation && (
                <p className="text-sm text-muted-foreground">
                  Continuing the current conversation.{" "}
                  <Button
                    type="button"
                    variant="link"
                    disabled={busy}
                    onClick={() => {
                      setConversation(null);
                      regenerateKey();
                    }}
                  >
                    Start a new conversation
                  </Button>
                </p>
              )}
              {current && (
                <p className="text-sm text-muted-foreground">
                  {pricingDescription(current.pricing)}
                  {current.pricing.mode !== "fixed" &&
                    " The maximum is reserved upfront; unused credits are released. Missing usage requires review."}
                </p>
              )}
              <Button disabled={busy || !prompt.trim()} type="submit">
                {busy
                  ? "Submitting…"
                  : `Send · ${current?.pricing.mode === "fixed" ? "" : "up to "}${current?.credits ?? 0} credits`}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Notice title="AI is not enabled">
          No AI capabilities are configured for this environment.
        </Notice>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Recent executions</h2>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            void refresh().catch(report);
          }}
        >
          Refresh
        </Button>
      </div>
      {!jobs.length && (
        <p className="text-muted-foreground">No executions yet.</p>
      )}
      {jobs.map((job) => (
        <Card key={job.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {capabilities.find((item) => item.name === job.capability)
                ?.title ?? job.capability}{" "}
              · {job.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="break-all text-xs text-muted-foreground">
              {job.id} · {job.createdAt.slice(0, 16).replace("T", " ")} UTC
            </p>
            <p className="text-sm">
              {job.chargedCredits === null
                ? `${job.credits} credits reserved`
                : `${job.chargedCredits} credits charged · ${job.credits} maximum`}
              {job.capped ? " · Charge capped" : ""}
              {job.simulated ? " · Simulated" : ""}
            </p>
            {typeof job.outputs?.text === "string" && (
              <p className="whitespace-pre-wrap break-words">
                {job.outputs.text}
              </p>
            )}
            {job.status === "needs-review" ||
            job.status === "settlement-blocked" ? (
              <Notice tone="warning" title="Administrator review required">
                The execution needs reconciliation. It will not be automatically
                submitted again.
              </Notice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {active.includes(job.status) && (
                <Button
                  variant="outline"
                  disabled={busy || job.cancelRequested}
                  onClick={() => {
                    void cancel(job);
                  }}
                >
                  {job.cancelRequested
                    ? "Cancellation requested"
                    : "Request cancellation"}
                </Button>
              )}
              {job.conversationId && job.status === "succeeded" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSelected(job.capability);
                    setConversation(job.conversationId);
                    regenerateKey();
                  }}
                >
                  Continue conversation
                </Button>
              )}
              <Button variant="link" asChild>
                <a href={`/ai/${job.id}`}>Details and usage</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-muted-foreground">
        Showing the latest 25 executions. Provider cost and application credits
        are separate.
      </p>
      <Button asChild variant="outline">
        <Link href="/ai/history">Browse all executions</Link>
      </Button>
    </div>
  );
}
