"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/client/api";
import {
  creationCapabilities,
  executionProfileSchema,
  profileDefinitionSchema,
  type ExecutionProfile,
} from "@/lib/contracts/execution-profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const historySchema = z.object({
  versions: z.array(
    executionProfileSchema.extend({ reason: z.string(), actorUid: z.string() }),
  ),
  next: z.number().nullable(),
});
export function ExecutionProfiles({
  uid,
  initial,
}: {
  uid: string;
  initial: ExecutionProfile[];
}) {
  const [profiles, setProfiles] = useState(initial);
  const [selected, setSelected] = useState("new");
  const [notice, setNotice] = useState("");
  const profile = profiles.find((p) => p.id === selected);
  return (
    <div className="space-y-5">
      {notice && <p role="status">{notice}</p>}
      <Label htmlFor="profile-choice">Profile</Label>
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger id="profile-choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">Create a profile</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name} · revision {p.revision}
              {p.enabled ? "" : " · disabled"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ProfileEditor
        key={`${selected}:${profile?.revision ?? 0}`}
        uid={uid}
        profile={profile}
        onSaved={(saved) => {
          setProfiles((old) => [
            ...old.filter((p) => p.id !== saved.id),
            saved,
          ]);
          setSelected(saved.id);
          setNotice(`Published ${saved.name}, revision ${saved.revision}.`);
        }}
      />
    </div>
  );
}
function ProfileEditor({
  uid,
  profile,
  onSaved,
}: {
  uid: string;
  profile?: ExecutionProfile;
  onSaved: (profile: ExecutionProfile) => void;
}) {
  const [definition, setDefinition] = useState<
    z.infer<typeof profileDefinitionSchema>
  >(() =>
    profile
      ? profileDefinitionSchema.strip().parse(profile)
      : {
          name: "",
          description: "",
          capability: "workspace-compose",
          binding: null,
          instructions: "",
          includeConversation: true,
          includeDecisions: true,
          requiresSource: false,
          audience: "everyone",
          enabled: true,
        },
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<z.infer<typeof historySchema> | null>(
    null,
  );
  const pending = useRef<{ intent: string; key: string; id: string } | null>(
    null,
  );
  const change = <K extends keyof typeof definition>(
    key: K,
    value: (typeof definition)[K],
  ) => setDefinition((old) => ({ ...old, [key]: value }));
  async function loadHistory(before?: number) {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      setHistory(
        await api(
          `/api/admin/execution-profiles/${profile.id}/history${before ? `?before=${before}` : ""}`,
          historySchema,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load revision history.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const intent = JSON.stringify({ definition, reason });
            const attempt =
              pending.current?.intent === intent
                ? pending.current
                : {
                    intent,
                    key: crypto.randomUUID(),
                    id: profile?.id ?? crypto.randomUUID(),
                  };
            pending.current = attempt;
            const saved = await api(
              "/api/admin/execution-profiles",
              executionProfileSchema,
              {
                method: "POST",
                body: {
                  key: attempt.key,
                  id: attempt.id,
                  expectedUid: uid,
                  revision: profile?.revision ?? 0,
                  definition,
                  reason,
                },
              },
            );
            pending.current = null;
            onSaved(saved);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Could not publish this revision.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={definition.name}
            onChange={(e) => change("name", e.target.value)}
            required
            maxLength={120}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-description">
            Description shown to users
          </Label>
          <Textarea
            id="profile-description"
            value={definition.description}
            onChange={(e) => change("description", e.target.value)}
            maxLength={1000}
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-task">Task</Label>
          <Select
            value={definition.capability}
            onValueChange={(value) =>
              change("capability", value as typeof definition.capability)
            }
            disabled={busy || Boolean(profile)}
          >
            <SelectTrigger id="profile-task">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {creationCapabilities.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-binding">
            Configured provider binding (optional)
          </Label>
          <Input
            id="profile-binding"
            value={definition.binding ?? ""}
            onChange={(e) => change("binding", e.target.value || null)}
            maxLength={64}
            disabled={busy}
          />
          <p className="text-sm text-muted-foreground">
            Leave empty for the task default. Enter a binding name configured on
            the server, never an API key. Its workflow must return this task’s
            output contract.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-instructions">Reusable instructions</Label>
          <Textarea
            id="profile-instructions"
            value={definition.instructions}
            onChange={(e) => change("instructions", e.target.value)}
            maxLength={6000}
            disabled={busy}
          />
          <p className="text-sm text-muted-foreground">
            Prepended to user instructions. Combined instructions are limited to
            10,000 characters. Do not store credentials here.
          </p>
        </div>
        {(
          [
            ["includeConversation", "Include recent messages"],
            ["includeDecisions", "Include saved decisions"],
            ["requiresSource", "Require a source artifact"],
            ["enabled", "Available for new batches"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <Checkbox
              id={`profile-${key}`}
              checked={definition[key]}
              onCheckedChange={(value) => change(key, value === true)}
              disabled={busy}
            />
            <Label htmlFor={`profile-${key}`}>{label}</Label>
          </div>
        ))}
        <div className="space-y-2">
          <Label htmlFor="profile-audience">Eligibility</Label>
          <Select
            value={definition.audience}
            onValueChange={(value) =>
              change("audience", value as "everyone" | "admins")
            }
            disabled={busy}
          >
            <SelectTrigger id="profile-audience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">All active accounts</SelectItem>
              <SelectItem value="admins">Administrators only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-reason">Reason for this revision</Label>
          <Textarea
            id="profile-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={5}
            maxLength={300}
            required
            disabled={busy}
          />
        </div>
        <Button disabled={busy}>
          Publish revision {(profile?.revision ?? 0) + 1}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {profile && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void loadHistory()}
        >
          View revision history
        </Button>
      )}
      {history && (
        <section aria-label="Profile revision history" className="space-y-3">
          {history.versions.map((version) => (
            <details className="rounded-md border p-3" key={version.revision}>
              <summary>
                Revision {version.revision} · {version.name} ·{" "}
                {version.enabled ? "enabled" : "disabled"}
              </summary>
              <p>{version.reason}</p>
              <p className="text-xs text-muted-foreground">
                {version.createdAt}
              </p>
              <pre className="overflow-auto whitespace-pre-wrap break-words text-sm">
                {JSON.stringify(version, null, 2)}
              </pre>
            </details>
          ))}
          {history.next && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void loadHistory(history.next!)}
            >
              Earlier revisions
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
