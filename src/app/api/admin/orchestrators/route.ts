import { orchestrators } from "@/lib/server/runs/orchestrators";
import { requireAdmin } from "@/lib/server/admin";
import { endpoint, json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    await requireAdmin();
    return json(await orchestrators(true));
  });
}
