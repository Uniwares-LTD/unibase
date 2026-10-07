import { myAsset } from "@/lib/server/workspaces/service";
import { endpoint } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const asset = await myAsset((await context.params).id);
    const download = new URL(request.url).searchParams.has("download");
    return new Response(Buffer.from(asset.base64, "base64"), {
      headers: {
        "content-type": asset.mime,
        "content-length": String(asset.bytes),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-disposition": `${download || asset.mime !== "image/png" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.name).replace(/'/g, "%27")}`,
      },
    });
  });
}
