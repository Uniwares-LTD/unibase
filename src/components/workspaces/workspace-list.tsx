"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { workspaceSchema } from "@/lib/contracts/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
export function WorkspaceList({
  uid,
  initial,
}: {
  uid: string;
  initial: {
    id: string;
    title: string;
    updatedAt: string;
    archivedAt?: string | null;
  }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Preserve the creation key across an ambiguous network failure.
  const [attempt, setAttempt] = useState<{ key: string; title: string } | null>(
    null,
  );
  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const request =
            attempt?.title === title
              ? attempt
              : { key: crypto.randomUUID(), title };
          setAttempt(request);
          try {
            const workspace = await api("/api/workspaces", workspaceSchema, {
              method: "POST",
              body: { ...request, expectedUid: uid },
            });
            router.push(`/workspaces/${workspace.id}`);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not create workspace.",
            );
            setBusy(false);
          }
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="workspace-title">Workspace name</Label>
          <Input
            id="workspace-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            required
            disabled={busy}
          />
        </div>
        <Button disabled={busy}>
          {busy ? "Creating…" : "Create workspace"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!initial.length && (
        <p className="text-muted-foreground">
          Create your first workspace to start a draft or generate a question.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((item) => (
          <Card key={item.id}>
            <CardContent>
              <Link
                className="font-medium underline underline-offset-4"
                href={`/workspaces/${item.id}`}
              >
                {item.title}
              </Link>
              <p className="mt-2 text-sm text-muted-foreground">
                Updated {item.updatedAt.slice(0, 10)}
                {item.archivedAt ? " · Archived" : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
