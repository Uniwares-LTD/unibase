import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { localeCookie, resolveLocale, timeZoneSchema } from "../locale";
import { getSession } from "./session";
import { database } from "./mongo";
export const requestLocale = cache(async () => {
  const jar = await cookies(),
    header = await headers();
  let saved: { locale?: string; timeZone?: string } | null = null;
  try {
    const actor = await getSession();
    if (actor)
      saved = await database()
        .collection<{ locale?: string; timeZone?: string }>("profiles")
        .findOne(
          { uid: actor.uid },
          { projection: { locale: 1, timeZone: 1 } },
        );
  } catch {
    /* Public recovery stays available during account outages. */
  }
  return {
    locale: resolveLocale(
      jar.get(localeCookie)?.value,
      saved?.locale,
      header.get("accept-language") ?? "",
    ),
    timeZone: timeZoneSchema.safeParse(saved?.timeZone).success
      ? saved!.timeZone!
      : "UTC",
  };
});
