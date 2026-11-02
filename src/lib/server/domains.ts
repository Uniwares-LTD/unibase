import "server-only";
import type { ClientSession, Db } from "mongodb";
import type { OrchestratorDefinition } from "../contracts/runs";
import type { AiJob } from "./ai/jobs";
import { AppError } from "../auth-policy";

export type OwnedTarget = {
  adapter: string;
  version: string;
  kind: string;
  id: string;
};
export interface DomainAdapter {
  id: string;
  version: string;
  kind: string;
  picker: { label: string; path: string };
  own(db: Db, uid: string, id: string, session?: ClientSession): Promise<void>;
  admit(db: Db, uid: string, id: string, session: ClientSession): Promise<void>;
  // Idempotent private staging only. Authorization and publication remain in apply().
  prepare?(
    db: Db,
    intent: { uid: string; jobId: string; target: OwnedTarget },
  ): Promise<void>;
  apply(
    db: Db,
    intent: { uid: string; jobId: string; target: OwnedTarget },
    session: ClientSession,
  ): Promise<void>;
  approval?(db: Db, job: AiJob, value: unknown): Promise<void>;
}
// Only trusted server code constructs registries. No persisted or browser-supplied executable names.
export function domainRegistry(adapters: readonly DomainAdapter[]) {
  const entries = new Map<string, DomainAdapter>();
  for (const adapter of adapters) {
    const key = `${adapter.id}@${adapter.version}`;
    if (entries.has(key)) throw new Error("Duplicate domain adapter version");
    entries.set(key, adapter);
  }
  return {
    get(id: string, version: string) {
      const adapter = entries.get(`${id}@${version}`);
      if (!adapter)
        throw new AppError(
          "DOMAIN_UNAVAILABLE",
          "This target integration is unavailable.",
          409,
        );
      return adapter;
    },
  };
}
const artifact: DomainAdapter = {
  id: "artifact",
  version: "1",
  kind: "artifact",
  picker: { label: "Saved artifact", path: "/api/artifacts" },
  async own(db, uid, id, session) {
    await (
      await import("./runs/artifacts")
    ).ownedArtifact(db, uid, id, session);
  },
  async admit(db, uid, id, session) {
    await this.own(db, uid, id, session);
    const result = await db
      .collection("artifacts")
      .updateOne(
        { id, uid, deleted: { $ne: true } },
        { $inc: { admissionFence: 1 } },
        { session },
      );
    if (!result.matchedCount)
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact is unavailable.",
        409,
      );
  },
  async apply(db, intent, session) {
    await (
      await import("./runs/artifacts")
    ).applyArtifactResult(
      db,
      { ...intent, artifactId: intent.target.id },
      session,
    );
  },
  async prepare(db, intent) {
    const { ownedArtifact } = await import("./runs/artifacts");
    await ownedArtifact(db, intent.uid, intent.target.id);
    const { stageProductAssets } = await import("./runs/assets");
    await stageProductAssets(db, intent.uid, intent.jobId);
  },
  async approval(db, job, value) {
    const { validateApprovalIntent } = await import("./runs/artifacts");
    await validateApprovalIntent(
      db,
      job,
      value as Parameters<typeof validateApprovalIntent>[2],
    );
  },
};
export const domains = domainRegistry([artifact]);
export function jobTarget(job: AiJob): OwnedTarget | undefined {
  return (
    job.run?.target ??
    (job.run?.artifactId
      ? {
          adapter: "artifact",
          version: "1",
          kind: "artifact",
          id: job.run.artifactId,
        }
      : undefined)
  );
}
export function resolveTarget(
  definition: OrchestratorDefinition,
  target?: { kind: string; id: string },
  artifactId?: string,
): OwnedTarget | undefined {
  if (
    artifactId &&
    target &&
    (target.kind !== "artifact" || target.id !== artifactId)
  )
    throw new AppError("INVALID_INPUT", "Conflicting target selections.");
  const selected =
    target ?? (artifactId ? { kind: "artifact", id: artifactId } : undefined);
  if (!selected) {
    if (
      definition.domainAdapter ||
      definition.privateTools?.some((t) => t.includes("artifact"))
    )
      throw new AppError(
        "ARTIFACT_REQUIRED",
        "Select an owned target for this workflow.",
      );
    return undefined;
  }
  const choice = definition.domainAdapter ?? { id: "artifact", version: "1" };
  const adapter = domains.get(choice.id, choice.version);
  if (adapter.kind !== selected.kind)
    throw new AppError(
      "INVALID_INPUT",
      "This workflow does not accept that target.",
    );
  return { ...selected, adapter: adapter.id, version: adapter.version };
}
