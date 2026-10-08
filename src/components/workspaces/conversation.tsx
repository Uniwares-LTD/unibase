"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { timelinePageSchema } from "@/lib/contracts/workspace-history";
import type { WorkspaceView } from "@/lib/contracts/workspace";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function Conversation({
  workspace,
  busy,
  onMessage,
}: {
  workspace: WorkspaceView;
  busy: boolean;
  onMessage: (text: string) => Promise<boolean>;
}) {
  const [history, setHistory] = useState<WorkspaceView["timeline"] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const displayed = history ?? workspace.timeline;
  const next = displayed.next;
  const entries = [...displayed.entries].reverse();
  async function loadOlder() {
    if (!next || loading) return;
    setLoading(true);
    setError("");
    try {
      const page = await api(
        `/api/workspaces/${workspace.id}/history?cursor=${encodeURIComponent(next)}`,
        timelinePageSchema,
      );
      setHistory(page);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <section aria-labelledby="conversation-heading" className="space-y-3">
      <h2 id="conversation-heading" className="text-xl font-semibold">
        Conversation
      </h2>
      <p className="text-sm text-muted-foreground">
        Messages are saved as context for future generations. Generate
        candidates below when you are ready.
      </p>
      {next && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => void loadOlder()}
        >
          {loading ? "Loading…" : "Load earlier activity"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {history && (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setHistory(null)}
        >
          Return to latest activity
        </Button>
      )}
      <ol
        className="max-h-96 space-y-3 overflow-y-auto rounded-lg border p-3"
        aria-label="Conversation history"
      >
        {!entries.length && (
          <li className="text-muted-foreground">
            New messages and activity will appear here.
          </li>
        )}
        {entries.map((entry) => (
          <li key={entry.id} className="space-y-1 border-b pb-3 last:border-0">
            <p className="text-xs text-muted-foreground">
              {entry.role} ·{" "}
              <time dateTime={entry.at}>
                {entry.at.replace("T", " ").slice(0, 19)} UTC
              </time>
            </p>
            {entry.parts.map((part, index) => (
              <div
                key={index}
                className="whitespace-pre-wrap break-words text-sm"
              >
                {part.type === "text" ? (
                  part.text
                ) : part.type === "execution" ? (
                  <Link className="underline" href="/ai">
                    Execution {part.state} · {part.jobId.slice(0, 12)}
                  </Link>
                ) : part.type === "card" ? (
                  <a className="underline" href="#decisions-heading">
                    View saved card
                  </a>
                ) : part.type === "artifact" ? (
                  <a className="underline" href="#artifacts-heading">
                    {workspace.artifacts
                      .find((a) => a.id === part.artifactId)
                      ?.versions.find((v) => v.number === part.version)
                      ?.title ?? "Artifact"}{" "}
                    · version {part.version}
                  </a>
                ) : (
                  <a className="underline" href="#batches-heading">
                    View candidate batch
                  </a>
                )}
              </div>
            ))}
          </li>
        ))}
      </ol>
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (text.trim() && (await onMessage(text.trim()))) {
            setText("");
            setHistory(null);
          }
        }}
      >
        <Label htmlFor="workspace-message">Message</Label>
        <Textarea
          id="workspace-message"
          value={text}
          maxLength={8000}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <Button disabled={busy || !text.trim()}>Save message</Button>
      </form>
    </section>
  );
}
