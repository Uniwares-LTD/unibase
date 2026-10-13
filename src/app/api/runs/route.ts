import { startRun, listRuns } from "@/lib/server/runs/service";
import { runStartSchema } from "@/lib/contracts/runs";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await listRuns(
        q.get("cursor") ?? undefined,
        q.get("status") ?? undefined,
      ),
    );
  });
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    return json(
      await startRun(await readJson(request, runStartSchema, 72000)),
      202,
    );
  });
}
