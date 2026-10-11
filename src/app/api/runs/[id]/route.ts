import { runDetail, runCommand } from "@/lib/server/runs/service";
import { runCommandSchema } from "@/lib/contracts/runs";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return endpoint(async () => json(await runDetail((await context.params).id)));
}
export async function POST(request: Request, context: Context) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await runCommand(
        (await context.params).id,
        await readJson(request, runCommandSchema, 72000),
      ),
      202,
    );
  });
}
