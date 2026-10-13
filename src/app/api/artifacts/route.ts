import { createArtifact, listArtifacts } from "@/lib/server/runs/artifacts";
import { artifactCreateSchema } from "@/lib/contracts/artifacts";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export async function POST(request: Request) {
  return endpoint(request, async () => {
    await checkMutation(request);
    return json(
      await createArtifact(await readJson(request, artifactCreateSchema)),
    );
  });
}

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const query = new URL(request.url).searchParams;
    return json(
      await listArtifacts(
        query.get("cursor") ?? undefined,
        query.get("search") ?? "",
      ),
    );
  });
}
