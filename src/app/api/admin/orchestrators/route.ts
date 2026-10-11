import {
  orchestrators,
  saveOrchestrator,
} from "@/lib/server/runs/orchestrators";
import { requireAdmin } from "@/lib/server/admin";
import { orchestratorUpdateSchema } from "@/lib/contracts/runs";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    await requireAdmin();
    return json(await orchestrators(true));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await saveOrchestrator(
        await readJson(request, orchestratorUpdateSchema, 100000),
      ),
    );
  });
}
