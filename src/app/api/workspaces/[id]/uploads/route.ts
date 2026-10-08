import { AppError } from "@/lib/auth-policy";
import { workspaceCommandSchema } from "@/lib/contracts/workspace";
import { readProviderBytes } from "@/lib/server/ai/dify";
import {
  assetUploadOptions,
  changeWorkspace,
} from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    const actor = await requireSession();
    const contentType = request.headers.get("content-type");
    if (!contentType?.startsWith("multipart/form-data;"))
      throw new AppError(
        "INVALID_UPLOAD",
        "Send a multipart image upload.",
        415,
      );
    let form: FormData;
    try {
      const bytes = await readProviderBytes(
        new Response(request.body),
        assetUploadOptions().maxImageBytes + 16 * 1024,
      );
      form = await new Response(new Uint8Array(bytes), {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      throw new AppError(
        "INVALID_UPLOAD",
        "Invalid or oversized image upload.",
        413,
      );
    }
    const file = form.get("file");
    const revision = form.get("revision");
    const fields = [...form.keys()];
    if (
      !(file instanceof File) ||
      typeof revision !== "string" ||
      !/^\d+$/.test(revision) ||
      fields.length !== 4 ||
      new Set(fields).size !== 4 ||
      fields.some(
        (key) => !["file", "key", "revision", "expectedUid"].includes(key),
      )
    )
      throw new AppError(
        "INVALID_UPLOAD",
        "Provide one file, request key, revision and expected account.",
      );
    if (form.get("expectedUid") !== actor.uid)
      throw new AppError(
        "ACCOUNT_CHANGED",
        "Your account changed. Reload before uploading.",
        409,
      );
    const parsed = workspaceCommandSchema.safeParse({
      action: "upload",
      name: file.name,
      base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      key: form.get("key"),
      expectedUid: actor.uid,
      revision: Number(revision),
    });
    if (!parsed.success)
      throw new AppError(
        "INVALID_UPLOAD",
        "Check the image name, request key and workspace revision.",
      );
    return json(
      await changeWorkspace((await context.params).id, parsed.data),
      201,
    );
  });
}
