import { endpoint, json, readJson } from "@/lib/server/http";
import { database } from "@/lib/server/mongo";
import { startUpload } from "@/lib/server/private-files";
import { uploadStartSchema } from "@/lib/contracts/files";
export async function POST(request: Request) {
  return endpoint(request, async (actor) =>
    json(
      await startUpload(
        database(),
        { uid: actor.uid, authTime: actor.auth_time },
        await readJson(request, uploadStartSchema),
      ),
    ),
  );
}
