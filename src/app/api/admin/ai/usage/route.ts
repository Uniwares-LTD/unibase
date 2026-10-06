import { listAdminAiUsage } from "@/lib/server/ai/service";
import { endpoint, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json(await listAdminAiUsage()));
}
