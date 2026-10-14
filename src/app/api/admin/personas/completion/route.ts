import { savePersonaCompletion } from "@/lib/server/runs/persona-completion-settings";
import { personaCompletionChangeSchema } from "@/lib/contracts/personas";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";

export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    return json(
      await savePersonaCompletion(
        await readJson(request, personaCompletionChangeSchema, 40000),
      ),
    );
  });
}
