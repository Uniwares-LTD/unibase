import { cleanupExecuteSchema } from "@/lib/contracts/operations";
import { runCleanup } from "@/lib/server/operations";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await runCleanup(await readJson(request, cleanupExecuteSchema)),
    );
  });
}
