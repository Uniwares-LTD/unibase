import { endpoint, json, readJson } from "@/lib/server/http";
import { updateMyLocalization } from "@/lib/server/profiles";
import { localizationSchema } from "@/lib/locale";
export async function PATCH(request: Request) {
  return endpoint(request, async () =>
    json(
      await updateMyLocalization(await readJson(request, localizationSchema)),
    ),
  );
}
