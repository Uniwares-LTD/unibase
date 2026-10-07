import { workspaceCommandSchema } from "@/lib/contracts/workspace";
import { myWorkspace, changeWorkspace } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return endpoint(async () =>
    json(await myWorkspace((await context.params).id)),
  );
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await changeWorkspace(
        (await context.params).id,
        await readJson(request, workspaceCommandSchema, 1_500_000),
      ),
    );
  });
}
