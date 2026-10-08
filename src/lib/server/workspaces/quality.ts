import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/auth-policy";
import { currentVersion } from "@/lib/contracts/workspace";
import type { QualityIssue } from "@/lib/contracts/quality";
import type { Workspace } from "./store";

// Stable IDs allow existing reviews to acquire issue tracking without rewriting
// their evidence or assigning different identities on concurrent reads.
function issueId(reviewId: string, index: number) {
  const hash = createHash("sha256")
    .update(`${reviewId}:${index}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function ensureQualityIssues(workspace: Workspace) {
  workspace.qualityIssues ??= [];
  const ids = new Set(workspace.qualityIssues.map((issue) => issue.id));
  for (const review of workspace.reviews) {
    review.result.issues.forEach((finding, index) => {
      const id = issueId(review.id, index);
      if (ids.has(id)) return;
      const approval = workspace.artifacts.find(
        (a) => a.id === review.artifactId,
      )?.approval;
      const accepted =
        finding.severity === "blocking" &&
        approval?.version === review.version &&
        approval.reason.length >= 10;
      workspace.qualityIssues.push({
        id,
        reviewId: review.id,
        artifactId: review.artifactId,
        version: review.version,
        severity: finding.severity,
        message: finding.message,
        status: accepted ? "accepted" : "open",
        repairRunIds: [],
        history: accepted
          ? [
              {
                action: "accept",
                uid: approval.uid,
                at: approval.at,
                reason: approval.reason,
                version: review.version,
                reviewId: review.id,
                runId: null,
              },
            ]
          : [],
      });
    });
  }
}
const conflict = (message: string) =>
  new AppError("WORKSPACE_CONFLICT", message, 409);
export function changeQualityIssue(
  workspace: Workspace,
  uid: string,
  id: string,
  action: "accept" | "reopen" | "resolve",
  reason: string,
  now: string,
) {
  const issue = workspace.qualityIssues.find((item) => item.id === id);
  if (!issue) throw conflict("Quality issue not found in this workspace.");
  if (issue.history.length >= 30)
    throw conflict("This issue reached its 30-action history limit.");
  const artifact = workspace.artifacts.find(
    (item) => item.id === issue.artifactId,
  )!;
  const version = currentVersion(artifact).number;
  let reviewId: string | null = issue.reviewId;
  if (action === "resolve") {
    const reviews = workspace.reviews.filter(
      (review) =>
        review.artifactId === artifact.id && review.version === version,
    );
    if (
      issue.status !== "open" ||
      version <= issue.version ||
      !reviews.length ||
      workspace.qualityIssues.some(
        (other) =>
          other.artifactId === artifact.id &&
          other.version === version &&
          other.severity === "blocking" &&
          other.status === "open",
      )
    )
      throw conflict(
        "Resolution requires an open issue, a newer artifact version and a fresh review with no open blocking findings.",
      );
    reviewId = reviews.at(-1)!.id;
    issue.status = "resolved";
  } else {
    if (
      action === "accept" &&
      (issue.status !== "open" || issue.version !== version)
    )
      throw conflict("Accept only open findings on the current version.");
    if (action === "reopen" && issue.status === "open")
      throw conflict("This issue is already open.");
    issue.status = action === "accept" ? "accepted" : "open";
  }
  issue.history.push({
    action,
    uid,
    at: now,
    reason,
    version,
    reviewId,
    runId: null,
  });
  return artifact.id;
}
export function blockingIssues(
  workspace: Workspace,
  artifactId: string,
  version: number,
): QualityIssue[] {
  return workspace.qualityIssues.filter(
    (issue) =>
      issue.artifactId === artifactId &&
      issue.version === version &&
      issue.severity === "blocking" &&
      issue.status === "open",
  );
}
