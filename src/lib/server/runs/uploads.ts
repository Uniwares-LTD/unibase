import "server-only";
import { AppError } from "@/lib/auth-policy";
import { requireSession } from "../session";
import { selectedOrchestrator } from "./orchestrators";
import { executionBinding } from "./provider";
import { createDifyFiles, uploadOwnedAiFile } from "../ai/files";
import { database } from "../mongo";
export async function readUpload(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
    throw new AppError("INVALID_INPUT", "Send a file upload.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT", "Choose a file.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 21 * 1024 * 1024) {
      await reader.cancel();
      throw new AppError(
        "FILE_TOO_LARGE",
        "File exceeds the upload limit.",
        413,
      );
    }
    chunks.push(value);
  }
  return new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: { "content-type": request.headers.get("content-type")! },
  }).formData();
}
export async function uploadInitialFile(id: string, key: string, file: File) {
  const actor = await requireSession();
  const selected = await selectedOrchestrator(id);
  const bound = executionBinding(selected.definition, selected.revision);
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
