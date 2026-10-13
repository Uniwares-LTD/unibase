import { z } from "zod";
import { uploadManagedFile } from "@/lib/server/runs/uploads";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
import { readUpload, uploadInitialFile } from "@/lib/server/runs/uploads";
import { AppError } from "@/lib/auth-policy";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    if (request.headers.get("content-type")?.startsWith("application/json")) {
      const input = await readJson(
        request,
        z.strictObject({
          orchestratorId: z.string().max(64),
          fileId: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      );
      return json(await uploadManagedFile(input.orchestratorId, input.fileId));
    }
    const form = await readUpload(request);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("INVALID_INPUT", "Choose a file.");
    return json(
      await uploadInitialFile(
        String(form.get("orchestratorId")),
        String(form.get("key")),
        file,
      ),
    );
  });
}
