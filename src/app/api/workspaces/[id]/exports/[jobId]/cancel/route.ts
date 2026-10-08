import { exportCancelSchema } from "@/lib/contracts/export";
import { cancelMyExport } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
type Context = { params: Promise<{ id: string; jobId: string }> };
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    await checkMutation(request);
    const { id, jobId } = await context.params;
    return json(
      await cancelMyExport(
        id,
        jobId,
        await readJson(request, exportCancelSchema),
      ),
    );
  });
}
