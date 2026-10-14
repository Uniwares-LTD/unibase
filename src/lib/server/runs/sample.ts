import "server-only";
import type { Db } from "mongodb";
import type { AiJob } from "../ai/jobs";
import { capabilityForRun } from "./capabilities";
import { artifactOperation, ownedArtifact } from "./artifacts";
export const sampleText =
  "A curious explorer discovers a garden of glowing flowers.";
export const sampleImage =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWPI7TtOU8QwakHfaBAdH01FuaMZ7fhoUZE7Wpr2jVY4uaNVZt9oq+L4aMOrb7TpeHxQt64Bo48Iagc7MYsAAAAASUVORK5CYII=";
export async function sampleDraft(db: Db, job: AiJob) {
  const artifact = await ownedArtifact(db, job.uid, job.run!.artifactId!);
  return artifactOperation(
    db,
    await capabilityForRun(db, job),
    process.env.RUN_MCP_CLIENT_ID ?? "dify",
    "save_artifact_draft_v1",
    {
      operationKey: "draft",
      expectedRevision: artifact.revision,
      text: sampleText,
    },
    new AbortController().signal,
  );
}
export async function sampleForm(db: Db, job: AiJob) {
  const draft = await db
    .collection("artifactRevisions")
    .findOne({ uid: job.uid, jobId: job._id }, { sort: { revision: -1 } });
  if (!draft) throw new Error("Sample draft unavailable");
  return {
    form_content:
      "```unibase-ui\n" +
      JSON.stringify({
        version: 1,
        approval: {
          artifactId: draft.artifactId,
          revision: draft.revision,
          contentHash: draft.contentHash,
          action: "approve",
          requireHuman: false,
        },
        cards: [
          {
            id: "draft",
            content: {
              type: "summary",
              version: 1,
              data: { title: "Approve this draft?", body: draft.text },
            },
          },
        ],
      }) +
      "\n```\n{{#$output.response#}}",
    inputs: [{ type: "paragraph", output_variable_name: "response" }],
    user_actions: [
      { id: "approve", title: "Approve" },
      { id: "decline", title: "Decline" },
      ...(job.run!.orchestrator.responseMode === "raw-v1"
        ? [{ id: "continue", title: "Continue" }]
        : []),
    ],
    resolved_default_values: {},
  };
}
export async function sampleApprove(db: Db, job: AiJob) {
  const draft = await db
    .collection("artifactRevisions")
    .findOne({ uid: job.uid, jobId: job._id }, { sort: { revision: -1 } });
  if (!draft) throw new Error("Sample draft unavailable");
  await artifactOperation(
    db,
    await capabilityForRun(db, job),
    process.env.RUN_MCP_CLIENT_ID ?? "dify",
    "approve_artifact_v1",
    {
      operationKey: "approval",
      revision: draft.revision,
      contentHash: draft.contentHash,
    },
    new AbortController().signal,
  );
}
