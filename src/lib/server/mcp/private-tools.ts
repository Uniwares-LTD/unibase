import "server-only";
import { z } from "zod";
import type { RegisteredTool } from "./tools";
import { database } from "../mongo";
import { authorizedRun } from "../runs/capabilities";
import { artifactOperation, ownedArtifact } from "../runs/artifacts";
import { artifactDraftSchema } from "@/lib/contracts/artifacts";
import { limits } from "@/lib/limits";
export const privateToolPermissions: Record<string, string> = {
  get_run_context_v1: "run:read",
  read_artifact_v1: "artifact:read",
  save_artifact_draft_v1: "artifact:write",
  approve_artifact_v1: "artifact:write",
};
const runContext = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const saved = z.strictObject({
  artifactId: z.string().uuid(),
  revision: z.number().int(),
  contentHash: z.string(),
});
export const privateTools: readonly RegisteredTool[] = [
  {
    name: "get_run_context_v1",
    description:
      "Read the context of the capability-authorized Run. No user identity argument is accepted.",
    permission: "run:read",
    input: z.strictObject({ runContext }),
    output: z.strictObject({
      runId: z.string(),
      artifactId: z.string().nullable(),
    }),
    async run(input, context) {
      context.signal.throwIfAborted();
      const job = await authorizedRun(
        database(),
        String(input.runContext),
        context.clientId,
        "get_run_context_v1",
      );
      return {
        runId: job.run!.logicalId,
        artifactId: job.run?.artifactId ?? null,
      };
    },
  },
  {
    name: "read_artifact_v1",
    description: "Read the artifact bound to this Run capability.",
    permission: "artifact:read",
    input: z.strictObject({ runContext }),
    output: z.strictObject({
      artifactId: z.string(),
      title: z.string(),
      revision: z.number().int(),
      draftText: z.string().max(limits.artifactTextChars),
    }),
    async run(input, context) {
      const db = database();
      context.signal.throwIfAborted();
      const job = await authorizedRun(
        db,
        String(input.runContext),
        context.clientId,
        "read_artifact_v1",
      );
      const artifact = await ownedArtifact(
        db,
        job.uid,
        job.run?.artifactId ?? "",
      );
      const draft = await db.collection("artifactRevisions").findOne({
        artifactId: artifact.id,
        uid: job.uid,
        revision: artifact.revision,
      });
      return {
        artifactId: artifact.id,
        title: artifact.title,
        revision: artifact.revision,
        draftText: draft?.text ?? "",
      };
    },
  },
  {
    name: "save_artifact_draft_v1",
    description:
      "Idempotently save a new owned artifact draft at the expected revision.",
    permission: "artifact:write",
    write: true,
    input: artifactDraftSchema.extend({ runContext }),
    output: saved,
    async run(input, context) {
      const { runContext: token, ...data } = input;
      return artifactOperation(
        database(),
        String(token),
        context.clientId,
        "save_artifact_draft_v1",
        data,
        context.signal,
      );
    },
  },
  {
    name: "approve_artifact_v1",
    description:
      "Approve the exact revision only after its persisted matching decision is confirmed.",
    permission: "artifact:write",
    write: true,
    input: z.strictObject({
      runContext,
      operationKey: z.string().regex(/^[A-Za-z0-9_:-]{1,128}$/),
      revision: z.number().int().positive(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
    output: saved,
    async run(input, context) {
      const { runContext: token, ...data } = input;
      return artifactOperation(
        database(),
        String(token),
        context.clientId,
        "approve_artifact_v1",
        data,
        context.signal,
      );
    },
  },
];
