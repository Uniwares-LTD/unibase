import { endpoint, json } from "@/lib/server/http";
import { database } from "@/lib/server/mongo";
import { completeUpload } from "@/lib/server/private-files";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async (actor) =>
    json(
      await completeUpload(database(), actor.uid, (await context.params).id),
    ),
  );
}
