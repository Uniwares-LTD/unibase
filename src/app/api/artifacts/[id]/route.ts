import { deleteArtifact } from "@/lib/server/runs/artifacts";
import { artifactCommandSchema } from "@/lib/contracts/artifacts";
import { endpoint, json, checkMutation, readJson } from "@/lib/server/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    await checkMutation(request);
    await readJson(request, artifactCommandSchema);
    return json(await deleteArtifact((await params).id));
  });
}
