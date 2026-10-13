import { endpoint, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { saveNotificationPreferences } from "@/lib/server/notifications";
import { notificationPreferencesSchema } from "@/lib/contracts/notifications";
export async function PATCH(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession(false);
    return json(
      await saveNotificationPreferences(
        database(),
        actor.uid,
        await readJson(request, notificationPreferencesSchema),
      ),
    );
  });
}
