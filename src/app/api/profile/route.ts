import { profileUpdateSchema } from "@/lib/contracts/profile";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
import { getMyProfile, updateMyProfile } from "@/lib/server/profiles";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json(await getMyProfile()));
}
export async function PATCH(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await updateMyProfile(await readJson(request, profileUpdateSchema)),
    );
  });
}
