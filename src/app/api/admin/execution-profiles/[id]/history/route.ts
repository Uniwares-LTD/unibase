import { z } from "zod";
import { requireAdmin } from "@/lib/server/admin";
import { database } from "@/lib/server/mongo";
import { profileHistory } from "@/lib/server/workspaces/profiles";
import { endpoint, json } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    await requireAdmin();
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const before = new URL(request.url).searchParams.get("before");
    return json(
      await profileHistory(
        database(),
        id,
        before
          ? z.coerce
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER)
              .parse(before)
          : undefined,
      ),
    );
  });
}
