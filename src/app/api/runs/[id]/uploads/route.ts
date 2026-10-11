import { endpoint, json, checkMutation } from "@/lib/server/http";
import { uploadRunFile } from "@/lib/server/runs/service";
import { readUpload } from "@/lib/server/runs/uploads";
import { AppError } from "@/lib/auth-policy";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    const form = await readUpload(request);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("INVALID_INPUT", "Choose a file.");
    return json(
      await uploadRunFile(
        (await context.params).id,
        String(form.get("attemptId")),
        String(form.get("key")),
        file,
      ),
    );
  });
}
