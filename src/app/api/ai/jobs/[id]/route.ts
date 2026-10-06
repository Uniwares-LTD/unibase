import { cancelMyAiJob, getMyAiJob } from "@/lib/server/ai/service";
import { checkMutation, endpoint, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return endpoint(async () =>
    json(await getMyAiJob((await context.params).id)),
  );
}
export async function DELETE(request: Request, context: Context) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(await cancelMyAiJob((await context.params).id), 202);
  });
}
