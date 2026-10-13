import { endpoint, json } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { ownedFile, fileDto, deleteFile } from "@/lib/server/private-files";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    return json(
      fileDto(
        await ownedFile(database(), actor.uid, (await context.params).id),
      ),
    );
  });
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    await deleteFile(
      database(),
      { uid: actor.uid, authTime: actor.auth_time },
      (await context.params).id,
    );
    return json({ ok: true });
  });
}
