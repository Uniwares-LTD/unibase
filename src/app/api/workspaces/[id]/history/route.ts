import { myWorkspaceHistory } from "@/lib/server/workspaces/service";
import { endpoint, json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    json(
      await myWorkspaceHistory(
        (await context.params).id,
        new URL(request.url).searchParams.get("cursor") ?? undefined,
      ),
    ),
  );
}
