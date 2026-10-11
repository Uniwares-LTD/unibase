import { endpoint, json, checkMutation } from "@/lib/server/http";
import { readUpload, uploadInitialFile } from "@/lib/server/runs/uploads";
import { AppError } from "@/lib/auth-policy";
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
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
