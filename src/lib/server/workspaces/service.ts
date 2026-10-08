import "server-only";
import { AppError } from "@/lib/auth-policy";
import {
  workspaceCommandSchema,
  workspaceCreateSchema,
  workspaceId,
} from "@/lib/contracts/workspace";
import { database } from "../mongo";
import { requireSession } from "../session";
import {
  commandWorkspace,
  createWorkspace,
  listWorkspaces,
  ownedWorkspace,
  workspaceView,
} from "./store";
import { privateAssetStore } from "./asset-storage";
import { imageByteLimit, parseAssetConfig } from "@/lib/config/assets";
import { assetByteLimit } from "@/lib/config/assets";
import { listExports, startExport, cancelExport } from "./export-jobs";
import { exportRenderers } from "./export-renderers";

export function exportOptions() {
  return {
    maxBytes: assetByteLimit(parseAssetConfig(process.env)),
    renderers: exportRenderers
      .list()
      .map(({ type, version, format, label }) => ({
        type,
        version,
        format,
        label,
      })),
  };
}
export async function myExports(id: string) {
  const actor = await requireSession();
  return listExports(database(), actor.uid, workspaceId.parse(id));
}
export async function newExport(id: string, input: unknown) {
  const actor = await requireSession();
  return startExport(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    workspaceId.parse(id),
    input,
  );
}
export async function cancelMyExport(
  id: string,
  jobId: string,
  input: unknown,
) {
  const actor = await requireSession();
  return cancelExport(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    workspaceId.parse(id),
    workspaceId.parse(jobId),
    input,
  );
}

export function assetUploadOptions() {
  return { maxImageBytes: imageByteLimit(parseAssetConfig(process.env)) };
}
import { workspaceHistory } from "./history";
import { candidateImage } from "./preview";
import { z } from "zod";
import { availableProfiles } from "./profiles";
import { creationCapabilities } from "@/lib/contracts/execution-profile";
import {
  availableCapabilities,
  capability,
  capabilityPricing,
  aiConfig,
} from "../ai/capabilities";
import { maximumCredits } from "@/lib/config/ai-pricing";
import { fingerprint } from "../ai/jobs";
import {
  listWorkflows,
  startWorkflow,
  changeWorkflow,
  startRepair,
} from "./workflows";

export async function newRepair(id: string, input: unknown) {
  const actor = await requireSession();
  return startRepair(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    workspaceId.parse(id),
    input,
  );
}

export async function myWorkflows(id: string) {
  const actor = await requireSession();
  return listWorkflows(database(), actor.uid, workspaceId.parse(id));
}
export async function newWorkflow(id: string, input: unknown) {
  const actor = await requireSession();
  return startWorkflow(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    workspaceId.parse(id),
    input,
  );
}
export async function updateWorkflow(
  id: string,
  runId: string,
  input: unknown,
) {
  const actor = await requireSession();
  return changeWorkflow(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    workspaceId.parse(id),
    workspaceId.parse(runId),
    input,
  );
}

export async function myExecutionOptions() {
  const actor = await requireSession();
  const profiles = await availableProfiles(database(), actor.uid);
  const defaults = availableCapabilities();
  const capabilities = creationCapabilities.flatMap((name) => {
    const defaultAvailable = defaults.some((c) => c.name === name);
    if (!defaultAvailable && !profiles.some((p) => p.capability === name))
      return [];
    const selected = capability(name);
    const pricing = capabilityPricing(selected);
    return [
      {
        name,
        title: selected.title,
        credits: maximumCredits(pricing),
        pricing,
        pricingKey: fingerprint(pricing),
        simulated: aiConfig().mode === "fake",
        defaultAvailable,
      },
    ];
  });
  return { profiles, capabilities };
}

export async function myWorkspaceHistory(id: string, cursor?: string) {
  const actor = await requireSession();
  const workspace = await ownedWorkspace(
    database(),
    actor.uid,
    workspaceId.parse(id),
  );
  return workspaceHistory(database(), actor.uid, workspace.id, cursor);
}
export async function myCandidateImage(id: string, jobId: string) {
  const actor = await requireSession();
  return candidateImage(
    database(),
    actor.uid,
    workspaceId.parse(id),
    z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(jobId),
  );
}

export async function myWorkspaces() {
  const actor = await requireSession();
  return (await listWorkspaces(database(), actor.uid)).map(
    ({ id, title, updatedAt, revision, archivedAt }) => ({
      id,
      title,
      updatedAt,
      revision,
      archivedAt: archivedAt ?? null,
    }),
  );
}
export async function newWorkspace(input: unknown) {
  const actor = await requireSession();
  const parsed = workspaceCreateSchema.parse(input);
  if (parsed.expectedUid !== actor.uid)
    throw new AppError(
      "ACCOUNT_CHANGED",
      "Your account changed. Reload before continuing.",
      409,
    );
  return workspaceView(
    database(),
    await createWorkspace(
      database(),
      { uid: actor.uid, authTime: actor.auth_time },
      parsed.key,
      parsed.title,
    ),
  );
}
export async function myWorkspace(id: string) {
  const actor = await requireSession();
  return workspaceView(
    database(),
    await ownedWorkspace(database(), actor.uid, workspaceId.parse(id)),
  );
}
export async function changeWorkspace(id: string, input: unknown) {
  const actor = await requireSession();
  return workspaceView(
    database(),
    await commandWorkspace(
      database(),
      { uid: actor.uid, authTime: actor.auth_time },
      workspaceId.parse(id),
      workspaceCommandSchema.parse(input),
    ),
  );
}
export async function myAsset(id: string) {
  const actor = await requireSession();
  const asset = await privateAssetStore(database()).get(
    actor.uid,
    workspaceId.parse(id),
  );
  if (!asset) throw new AppError("NOT_FOUND", "Asset not found.", 404);
  return asset;
}
