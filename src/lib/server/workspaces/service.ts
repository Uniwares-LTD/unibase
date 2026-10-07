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
import { mongoAssetStore } from "./assets";

export async function myWorkspaces() {
  const actor = await requireSession();
  return (await listWorkspaces(database(), actor.uid)).map(
    ({ id, title, updatedAt, revision }) => ({
      id,
      title,
      updatedAt,
      revision,
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
  const asset = await mongoAssetStore(database()).get(
    actor.uid,
    workspaceId.parse(id),
  );
  if (!asset) throw new AppError("NOT_FOUND", "Asset not found.", 404);
  return asset;
}
