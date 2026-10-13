import "server-only";
import { readMultipart } from "@/lib/upload-body";
import { readSettings } from "../settings";
import { requireSession } from "../session";
import { selectedOrchestrator } from "./orchestrators";
import { executionBinding } from "./provider";
import { createDifyFiles, uploadOwnedAiFile } from "../ai/files";
import { database } from "../mongo";
export async function readUpload(request: Request) {
  // Authentication precedes even acquiring the body reader. Services recheck ownership.
  await requireSession();
  const { settings } = await readSettings();
  return readMultipart(request, settings.runs.uploadBytes);
}
export async function uploadInitialFile(id: string, key: string, file: File) {
  const actor = await requireSession();
  const selected = await selectedOrchestrator(id);
  const bound = await executionBinding(selected.definition, selected.revision);
  const result = await uploadOwnedAiFile(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    key,
    bound.snapshot,
    file,
    bound.snapshot.mode === "fake"
      ? async () => ({ kind: "ok", value: { id: crypto.randomUUID() } })
      : createDifyFiles(bound.config, bound.binding).upload,
  );
  return { id: result._id, status: result.status };
}

export async function uploadManagedFile(orchestratorId: string, id: string) {
  const actor = await requireSession();
  const { requireModule } = await import("../modules");
  requireModule("files");
  const { fileBytes } = await import("../private-files");
  const { file, bytes } = await fileBytes(database(), actor.uid, id);
  const selected = await selectedOrchestrator(orchestratorId);
  const bound = await executionBinding(selected.definition, selected.revision);
  const { fingerprint } = await import("../ai/jobs");
  const result = await uploadOwnedAiFile(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    "managed_" + fingerprint([id, bound.snapshot.fingerprint]),
    bound.snapshot,
    new File([new Uint8Array(bytes)], file.name, { type: file.mime }),
    bound.snapshot.mode === "fake"
      ? async () => ({ kind: "ok", value: { id: crypto.randomUUID() } })
      : createDifyFiles(bound.config, bound.binding).upload,
    id,
  );
  return { id: result._id, status: result.status };
}
