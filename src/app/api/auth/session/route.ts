import { sessionInputSchema } from "@/lib/contracts/profile";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
import { clearSession, createSession } from "@/lib/server/session";
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    const { idToken } = await readJson(request, sessionInputSchema);
    return json(await createSession(idToken));
  });
}
export async function DELETE(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    await clearSession();
    return json({ ok: true });
  });
}
