import { aiResolutionSchema } from "@/lib/contracts/ai";
import { resolveManagedAiJob } from "@/lib/server/ai/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await resolveManagedAiJob(
        (await context.params).id,
        await readJson(request, aiResolutionSchema),
      ),
    );
  });
}
