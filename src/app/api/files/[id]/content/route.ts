import { endpoint } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { fileBytes } from "@/lib/server/private-files";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async () => {
    const actor = await requireSession();
    const { file, bytes } = await fileBytes(
      database(),
      actor.uid,
      (await context.params).id,
    );
    const name = encodeURIComponent(file.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${file.mime === "image/png" ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${name}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  });
}
