import {
  manageDify,
  managementCommandSchema,
} from "@/lib/server/runs/dify-management";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await manageDify(
        await readJson(request, managementCommandSchema, 550000),
      ),
    );
  });
}
