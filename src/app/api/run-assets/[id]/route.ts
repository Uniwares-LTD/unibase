import { readRunAsset } from "@/lib/server/runs/media";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { endpoint } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    const { bytes, asset } = await readRunAsset(
      database(),
      actor.uid,
      (await context.params).id,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  });
}
