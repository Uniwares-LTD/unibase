import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireAdmin } from "@/lib/server/admin";
import { endpoint } from "@/lib/server/http";
import { AppError } from "@/lib/auth-policy";
const templates = {
  generation: "orchestrators/generation.yaml",
  decision: "orchestrators/ui-decision.yaml",
  mcp: "orchestrators/mcp-reference.yaml",
  failure: "examples/failure.yaml",
  recovery: "examples/checkpoint-recovery.yaml",
  image: "examples/image-result.yaml",
  child: "workflows/child-question.yaml",
};
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  return endpoint(async () => {
    await requireAdmin();
    const { name } = await params;
    if (!Object.hasOwn(templates, name))
      throw new AppError("NOT_FOUND", "Template unavailable.", 404);
    const file = templates[name as keyof typeof templates];
    return new Response(
      await readFile(join(process.cwd(), "dify", file), "utf8"),
      {
        headers: {
          "Content-Type": "application/yaml",
          "Content-Disposition": `attachment; filename="${name}.yaml"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  });
}
