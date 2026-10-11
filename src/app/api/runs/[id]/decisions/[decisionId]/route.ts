import { submitDecision } from "@/lib/server/runs/service";
import { decisionSubmitSchema } from "@/lib/contracts/runs";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; decisionId: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    const p = await context.params;
    return json(
      await submitDecision(
        p.id,
        p.decisionId,
        await readJson(request, decisionSubmitSchema, 72000),
      ),
    );
  });
}
