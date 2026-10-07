import { workspaceCreateSchema } from "@/lib/contracts/workspace";
import { myWorkspaces, newWorkspace } from "@/lib/server/workspaces/service";
import { checkMutation, endpoint, json, readJson } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET() {
  return endpoint(async () => json(await myWorkspaces()));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    await checkMutation(request);
    return json(
      await newWorkspace(await readJson(request, workspaceCreateSchema)),
      201,
    );
  });
}
