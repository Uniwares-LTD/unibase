import { endpoint, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { listFiles, saveFile } from "@/lib/server/private-files";
import { readUpload } from "@/lib/server/runs/uploads";
import { AppError } from "@/lib/auth-policy";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    return json(
      await listFiles(
        database(),
        actor.uid,
        new URL(request.url).searchParams.get("cursor") ?? undefined,
      ),
    );
  });
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    const form = await readUpload(request);
    const file = form.get("file");
    if (!(file instanceof File))
      throw new AppError("INVALID_INPUT", "Choose a file.");
    return json(
      await saveFile(
        database(),
        { uid: actor.uid, authTime: actor.auth_time },
        String(form.get("key")),
        file,
      ),
    );
  });
}
