import { repairStartSchema } from "@/lib/contracts/quality";
import { newRepair } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await newRepair(
        (await context.params).id,
        await readJson(request, repairStartSchema, 20_000),
      ),
    );
  });
}
