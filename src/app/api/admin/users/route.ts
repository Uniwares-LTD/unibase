import { endpoint, json } from "@/lib/server/http";
import { listManagedUsers } from "@/lib/server/admin";

export async function GET(request: Request) {
  return endpoint(request, async () => {
    const params = new URL(request.url).searchParams;
    return json(
      await listManagedUsers(
        params.get("q")?.trim() ?? "",
        params.get("page") ?? undefined,
      ),
    );
  });
}
