import "server-only";
import type { Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import { imageOutputSchema } from "@/lib/contracts/workspace";
import { aiJobs } from "../ai/jobs";
import { ownedWorkspace } from "./store";
import { validatedImage } from "./assets";

export async function candidateImage(
  db: Db,
  uid: string,
  workspaceId: string,
  jobId: string,
) {
  const workspace = await ownedWorkspace(db, uid, workspaceId);
  const belongs = workspace.batches.some(
    (batch) =>
      batch.capability === "workspace-image" &&
      batch.items.some((item) => item.jobId === jobId),
  );
  if (!belongs)
    throw new AppError("NOT_FOUND", "Candidate image not found.", 404);
  const job = await aiJobs(db).findOne({
    _id: jobId,
    uid,
    capability: "workspace-image",
    "source.type": "workspace",
    "source.id": workspaceId,
    status: "succeeded",
    cleanedAt: { $exists: false },
  });
  if (!job?.execution)
    throw new AppError("NOT_FOUND", "Candidate image not available.", 404);
  return validatedImage(imageOutputSchema.parse(job.execution.outputs).png);
}
