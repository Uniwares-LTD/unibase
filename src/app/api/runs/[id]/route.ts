import { runDetail, runCommand } from "@/lib/server/runs/service";
import { runCommandSchema } from "@/lib/contracts/runs";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rate-limit";
import { requireSession } from "@/lib/server/session";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return endpoint(request, async () => {
    const q = new URL(request.url).searchParams;
    return json(
      await runDetail((await context.params).id, {
        decisions: q.get("decisions") ?? undefined,
        actionable: q.get("actionable") ?? undefined,
        events: q.get("events") ?? undefined,
      }),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return endpoint(request, async () => {
    await checkMutation(request);
    const input = await readJson(request, runCommandSchema, 72000);
    if (
      input.action === "restart" ||
      input.action === "recover" ||
      input.action === "test-stage"
    ) {
      const actor = await requireSession();
      await limitRequest("account:" + actor.uid, "admission");
    }
    return json(await runCommand((await context.params).id, input), 202);
  });
}
