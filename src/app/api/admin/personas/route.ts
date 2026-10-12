import { personasView, savePersona } from "@/lib/server/runs/personas";
import { personaChangeSchema } from "@/lib/contracts/personas";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export async function GET() {
  return endpoint(async () => json(await personasView()));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await savePersona(await readJson(request, personaChangeSchema, 16000)),
    );
  });
}
