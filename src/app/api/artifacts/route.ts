import { createArtifact } from "@/lib/server/runs/artifacts";
import { artifactCreateSchema } from "@/lib/contracts/artifacts";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await createArtifact(await readJson(request, artifactCreateSchema)),
    );
  });
}
