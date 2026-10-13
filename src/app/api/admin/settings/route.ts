import { settingsView, updateSettings } from "@/lib/server/settings";
import { settingsUpdateSchema } from "@/lib/contracts/settings";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, async () => json(await settingsView()));
}
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    return json(
      await updateSettings(
        await readJson(request, settingsUpdateSchema, 100000),
      ),
    );
  });
}
