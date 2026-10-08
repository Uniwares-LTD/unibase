import { exportStartSchema } from "@/lib/contracts/export";
import { myExports, newExport } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return endpoint(async () => json(await myExports((await context.params).id)));
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await newExport(
        (await context.params).id,
        await readJson(request, exportStartSchema),
      ),
      202,
    );
  });
}
