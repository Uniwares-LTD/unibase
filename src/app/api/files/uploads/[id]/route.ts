import { endpoint, json } from "@/lib/server/http";
import { database } from "@/lib/server/mongo";
import { uploadStatus } from "@/lib/server/private-files";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async (actor) =>
    json(await uploadStatus(database(), actor.uid, (await context.params).id)),
  );
}
