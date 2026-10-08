import { requireAdmin } from "@/lib/server/admin";
import { database } from "@/lib/server/mongo";
import {
  listExecutionProfiles,
  saveExecutionProfile,
} from "@/lib/server/workspaces/profiles";
import { profileSaveSchema } from "@/lib/contracts/execution-profile";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => {
    await requireAdmin();
    return json(await listExecutionProfiles(database()));
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    const actor = await requireAdmin(true);
    return json(
      await saveExecutionProfile(
        database(),
        { uid: actor.uid, authTime: actor.auth_time },
        await readJson(request, profileSaveSchema, 50000),
      ),
    );
  });
}
