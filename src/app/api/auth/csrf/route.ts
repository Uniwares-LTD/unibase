import { endpoint, issueCsrf, json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json({ token: await issueCsrf() }));
}
