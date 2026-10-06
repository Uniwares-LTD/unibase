import { isReady, releaseCommit } from "@/lib/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const ready = await isReady();
  return Response.json(
    { status: ready ? "ready" : "unavailable", commit: releaseCommit() },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
