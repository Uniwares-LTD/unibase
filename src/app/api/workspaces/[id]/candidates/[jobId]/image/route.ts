import { myCandidateImage } from "@/lib/server/workspaces/service";
import { endpoint } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; jobId: string }> },
) {
  return endpoint(async () => {
    const { id, jobId } = await context.params;
    const image = await myCandidateImage(id, jobId);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}
