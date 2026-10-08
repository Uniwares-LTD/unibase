import "server-only";
import type { ClientSession, Db } from "mongodb";
import { studioOutputSchema } from "@/lib/contracts/workspace";
import { artifactRegistry } from "@/lib/creation/artifacts";
import { cardRegistry } from "@/lib/creation/cards";
import { fingerprint, type AiJob } from "../ai/jobs";
import type { ProviderExecution } from "../ai/types";
import { workspaceEvents } from "./history";

// Database-only settlement hook: validates ownership before credits can settle
// and appends durable execution evidence in the existing settlement transaction.
export async function materializeWorkspaceExecution(
  db: Db,
  job: AiJob,
  result: ProviderExecution,
  session: ClientSession,
) {
  let assetIds: string[] = [];
  if (job.capability === "workspace-compose") {
    const output = studioOutputSchema.parse(result.outputs);
    if (output.type === "artifact")
      assetIds = artifactRegistry
        .get(output.artifact.type, output.artifact.version)
        .project(output.artifact.data).assetIds;
    if (output.type === "card")
      assetIds = cardRegistry
        .get(output.card.type, output.card.version)
        .assets(output.card.data);
  }
  if (assetIds.length) {
    if (job.source?.type !== "workspace")
      throw new Error("Owned workspace asset context is required.");
    const unique = [...new Set(assetIds)];
    const owned = await db
      .collection<{ _id: string; uid: string; workspaceId: string }>(
        "workspaceAssets",
      )
      .countDocuments(
        { _id: { $in: unique }, uid: job.uid, workspaceId: job.source.id },
        { session },
      );
    if (owned !== unique.length)
      throw new Error("Generated content references unavailable assets.");
  }
  if (job.source?.type !== "workspace") return;
  await workspaceEvents(db).updateOne(
    { _id: fingerprint([job._id, "workspace-result"]) },
    {
      $setOnInsert: {
        uid: job.uid,
        workspaceId: job.source.id,
        createdAt: new Date(),
        role: "assistant",
        kind: "execution",
        parts: [{ type: "execution", jobId: job._id, state: "succeeded" }],
      },
    },
    { session, upsert: true },
  );
}
