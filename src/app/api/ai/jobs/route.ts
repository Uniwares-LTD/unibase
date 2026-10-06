import { aiSubmitSchema } from "@/lib/contracts/ai";
import { listMyAiJobs, submitAiJob } from "@/lib/server/ai/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json(await listMyAiJobs()));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      // Allow the 64 KiB input budget plus a bounded JSON request envelope.
      await submitAiJob(await readJson(request, aiSubmitSchema, 72 * 1024)),
      202,
    );
  });
}
