import { profileUpdateSchema } from "@/lib/contracts/profile";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
import { getMyProfile, updateMyProfile } from "@/lib/server/profiles";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return endpoint(request, async () => json(await getMyProfile()));
}
export async function PATCH(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    return json(
      await updateMyProfile(await readJson(request, profileUpdateSchema)),
    );
  });
}
