import { workflowActionSchema } from "@/lib/contracts/workflow";
import { updateWorkflow } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; runId: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    const { id, runId } = await context.params;
    return json(
      await updateWorkflow(
        id,
        runId,
        await readJson(request, workflowActionSchema, 4096),
      ),
    );
  });
}
