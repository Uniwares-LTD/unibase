"use client";
import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { currentVersion, type WorkspaceView } from "@/lib/contracts/workspace";
import { workflowRunSchema } from "@/lib/contracts/workflow";
import type { RepairStart } from "@/lib/contracts/quality";
import type { ProfileSummary } from "@/lib/contracts/execution-profile";
import type { Capability } from "./workspace-editor";
import { RegisteredCard } from "./registered-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function QualityPanel({
  uid,
  workspace,
  artifact,
  capabilities,
  profiles,
  disabled,
  onChange,
  onIssue,
}: {
  uid: string;
  workspace: WorkspaceView;
  artifact: WorkspaceView["artifacts"][number];
  capabilities: Capability[];
  profiles: ProfileSummary[];
  disabled: boolean;
  onChange: () => Promise<void>;
  onIssue: (
    id: string,
    resolution: "accept" | "reopen" | "resolve",
    reason: string,
  ) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [instructions, setInstructions] = useState("");
  const [composeProfile, setComposeProfile] = useState("default");
  const [reviewProfile, setReviewProfile] = useState("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<{ intent: string; body: RepairStart } | null>(null);
  const issues = workspace.qualityIssues.filter(
    (issue) => issue.artifactId === artifact.id,
  );
  if (!issues.length) return null;
  const current = currentVersion(artifact).number;
  const compose = capabilities.find((c) => c.name === "workspace-compose");
  const review = capabilities.find((c) => c.name === "workspace-review");
  const maximum = (compose?.credits ?? 0) + (review?.credits ?? 0);
  const available =
    compose &&
    review &&
    (compose.defaultAvailable !== false || composeProfile !== "default") &&
    (review.defaultAvailable !== false || reviewProfile !== "default");
  const cleanReview =
    workspace.reviews.some(
      (r) => r.artifactId === artifact.id && r.version === current,
    ) &&
    !issues.some(
      (issue) =>
        issue.version === current &&
        issue.status === "open" &&
        issue.severity === "blocking",
    );
  const locked = disabled || busy;
  async function repair() {
    if (inFlight.current || !compose || !review) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const reference = (id: string) => {
      const profile = profiles.find((p) => p.id === id);
      return profile ? { id: profile.id, revision: profile.revision } : null;
    };
    const body: RepairStart = {
      key: crypto.randomUUID(),
      expectedUid: uid,
      revision: workspace.revision,
      artifactId: artifact.id,
      issueIds: selected,
      instructions,
      composeProfile: reference(composeProfile),
      reviewProfile: reference(reviewProfile),
      composePricingKey: compose.pricingKey,
      reviewPricingKey: review.pricingKey,
      maximumCredits: maximum,
    };
    const intent = JSON.stringify({
      ...body,
      key: undefined,
      revision: undefined,
    });
    const request =
      pending.current?.intent === intent ? pending.current : { intent, body };
    pending.current = request;
    try {
      await api(`/api/workspaces/${workspace.id}/repairs`, workflowRunSchema, {
        method: "POST",
        body: request.body,
      });
      pending.current = null;
      setSelected([]);
      setNotice(
        "Repair started. Follow its progress in Workflows; review the new version before resolving findings.",
      );
      await onChange();
    } catch (e) {
      if (
        e instanceof ApiError &&
        ["WORKFLOW_CONFLICT", "WORKSPACE_CONFLICT"].includes(e.code)
      ) {
        pending.current = null;
        await onChange();
      }
      setError(
        e instanceof Error
          ? e.message
          : "Could not start repair. Retry the same request.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3"
      aria-label={`Quality findings for ${currentVersion(artifact).title}`}
    >
      <h4 className="font-medium">Tracked quality findings</h4>
      <div className="space-y-2">
        <Label htmlFor={`${artifact.id}-issue-reason`}>
          Reason for accepting, reopening or resolving a finding
        </Label>
        <Textarea
          id={`${artifact.id}-issue-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={10}
          maxLength={2000}
          disabled={locked}
        />
      </div>
      {issues.map((issue) => (
        <div key={issue.id} className="space-y-2 rounded-md border p-3">
          <RegisteredCard
            card={{
              id: issue.id,
              content: {
                type: "issue",
                version: 1,
                data: {
                  title: `Finding on version ${issue.version}`,
                  severity:
                    issue.severity === "blocking" ? "blocking" : "warning",
                  details: [issue.message],
                },
              },
              status: "active",
              response: null,
              responseAction: null,
              createdAt: "",
              answeredAt: null,
              sourceJobId: null,
            }}
            disabled
            onRespond={() => undefined}
          />
          <p className="text-sm">
            {issue.status} · {issue.repairRunIds.length}/3 repair attempts
          </p>
          {issue.status === "open" && issue.repairRunIds.length < 3 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`repair-${issue.id}`}
                checked={selected.includes(issue.id)}
                disabled={
                  locked ||
                  (selected.length >= 5 && !selected.includes(issue.id))
                }
                onCheckedChange={(checked) =>
                  setSelected((old) =>
                    checked === true
                      ? [...old, issue.id]
                      : old.filter((id) => id !== issue.id),
                  )
                }
              />
              <Label htmlFor={`repair-${issue.id}`}>
                Include this finding in targeted repair
              </Label>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {issue.status === "open" && issue.version === current && (
              <Button
                variant="outline"
                disabled={locked || reason.trim().length < 10}
                onClick={() => void onIssue(issue.id, "accept", reason.trim())}
              >
                Accept finding
              </Button>
            )}
            {issue.status !== "open" && (
              <Button
                variant="outline"
                disabled={locked || reason.trim().length < 10}
                onClick={() => void onIssue(issue.id, "reopen", reason.trim())}
              >
                Reopen finding
              </Button>
            )}
            {issue.status === "open" && issue.version < current && (
              <Button
                variant="outline"
                disabled={locked || reason.trim().length < 10 || !cleanReview}
                onClick={() => void onIssue(issue.id, "resolve", reason.trim())}
              >
                Mark resolved after re-review
              </Button>
            )}
          </div>
          {!!issue.history.length && (
            <details>
              <summary className="cursor-pointer text-sm underline">
                Finding history
              </summary>
              <ol className="space-y-2 pt-2 text-sm">
                {issue.history.map((entry, index) => (
                  <li key={index} className="break-words">
                    {entry.action} · version {entry.version} ·{" "}
                    {entry.at.replace("T", " ").slice(0, 19)} UTC
                    <br />
                    {entry.reason}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}
      <form
        className="space-y-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void repair();
        }}
      >
        <h5 className="font-medium">Repair selected findings</h5>
        <p className="text-sm text-muted-foreground">
          Select up to five open findings. Each run creates a new artifact
          version, re-reviews it and waits for your approval. Findings remain
          open until you explicitly resolve or accept them. Maximum three repair
          runs per finding.
        </p>
        <div className="space-y-2">
          <Label htmlFor={`${artifact.id}-repair-instructions`}>
            Additional repair instructions (optional)
          </Label>
          <Textarea
            id={`${artifact.id}-repair-instructions`}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            maxLength={1500}
            disabled={locked}
          />
        </div>
        {(
          [
            {
              name: "workspace-compose",
              label: "Repair profile",
              value: composeProfile,
              set: setComposeProfile,
              capability: compose,
            },
            {
              name: "workspace-review",
              label: "Re-review profile",
              value: reviewProfile,
              set: setReviewProfile,
              capability: review,
            },
          ] as const
        ).map((task) => (
          <div className="space-y-2" key={task.name}>
            <Label htmlFor={`${artifact.id}-${task.name}-profile`}>
              {task.label}
            </Label>
            <Select
              value={task.value}
              onValueChange={task.set}
              disabled={locked}
            >
              <SelectTrigger
                id={`${artifact.id}-${task.name}-profile`}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="default"
                  disabled={task.capability?.defaultAvailable === false}
                >
                  Task default
                </SelectItem>
                {profiles
                  .filter((profile) => profile.capability === task.name)
                  .map((profile) => (
                    <SelectItem value={profile.id} key={profile.id}>
                      {profile.name} · revision {profile.revision}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        ))}
        <p className="text-sm">
          Up to {maximum} credits for repair and re-review, reserved as each
          step starts.
        </p>
        <Button
          disabled={
            locked || workspace.paused || !available || !selected.length
          }
        >
          Start targeted repair
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm">
        {busy ? "Starting repair…" : notice}
      </p>
    </section>
  );
}
