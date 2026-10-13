import { endpoint } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { notificationDestination } from "@/lib/server/notifications";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const actor = await requireSession(false);
    const path = await notificationDestination(
      database(),
      actor.uid,
      (await context.params).id,
    );
    return new Response(null, {
      status: 303,
      headers: { Location: path, "Cache-Control": "private, no-store" },
    });
  });
}
