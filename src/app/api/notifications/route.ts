import { requestLocale } from "@/lib/server/locale";
import { z } from "zod";
import { endpoint, json, readJson } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import {
  notificationPage,
  markNotificationsRead,
} from "@/lib/server/notifications";
export async function GET(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession(false);
    return json(
      await notificationPage(
        database(),
        actor.uid,
        new URL(request.url).searchParams.get("cursor") ?? undefined,
        (await requestLocale()).locale,
      ),
    );
  });
}
export async function PATCH(request: Request) {
  return endpoint(request, async () => {
    const actor = await requireSession(false);
    const input = await readJson(
      request,
      z.union([
        z.strictObject({ all: z.literal(true) }),
        z.strictObject({
          ids: z
            .array(z.string().regex(/^[a-f0-9]{64}$/))
            .min(1)
            .max(100),
        }),
      ]),
    );
    await markNotificationsRead(
      database(),
      actor.uid,
      "ids" in input ? input.ids : undefined,
    );
    return json({ ok: true });
  });
}
