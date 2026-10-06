import { AppError } from "@/lib/auth-policy";
import { readProviderBytes } from "@/lib/server/ai/dify";
import { AI_FILE_LIMIT } from "@/lib/server/ai/files";
import { listMyAiFiles, uploadMyAiFile } from "@/lib/server/ai/service";
import { checkMutation, endpoint, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json(await listMyAiFiles()));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    const session = await requireSession();
    if (
      !request.headers.get("content-type")?.startsWith("multipart/form-data;")
    )
      throw new AppError("AI_FILE_FORM", "Send a multipart file upload.", 415);
    let form: FormData;
    try {
      const bytes = await readProviderBytes(
        new Response(request.body),
        AI_FILE_LIMIT + 16 * 1024,
      );
      form = await new Response(new Uint8Array(bytes), {
        headers: { "content-type": request.headers.get("content-type")! },
      }).formData();
    } catch {
      throw new AppError(
        "AI_FILE_FORM",
        "Invalid or oversized file upload.",
        413,
      );
    }
    const file = form.get("file");
    const name = form.get("capability");
    const key = form.get("key");
    const expectedUid = form.get("expectedUid");
    if (expectedUid && expectedUid !== session.uid)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Your account changed. Reload before continuing.",
        409,
      );
    if (
      !(file instanceof File) ||
      typeof name !== "string" ||
      typeof key !== "string"
    )
      throw new AppError(
        "AI_FILE_FORM",
        "Provide file, capability and key fields.",
      );
    return json(await uploadMyAiFile(name, key, file), 201);
  });
}
