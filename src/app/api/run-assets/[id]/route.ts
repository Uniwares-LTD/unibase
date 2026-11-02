import { readRunAsset, runAssetDigest } from "@/lib/server/runs/media";
import { requireVerified } from "@/lib/server/session";
import { database } from "@/lib/server/mongo";
import { endpoint } from "@/lib/server/http";
export const dynamic = "force-dynamic";

const sizes = ["thumb", "preview", "original"] as const;
type Size = (typeof sizes)[number];

// Asset bytes never change for an ID. A short private freshness window avoids
// re-downloads while browsing; afterwards the browser revalidates with the
// ETag, which re-checks the session and ownership and answers 304 cheaply.
// No long-lived cache, so shared devices and deleted images expire quickly.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return endpoint(request, async (actor) => {
    const session = requireVerified(actor);
    const requested = new URL(request.url).searchParams.get("size");
    const size: Size = sizes.includes(requested as Size)
      ? (requested as Size)
      : "original";
    const id = (await context.params).id;
    const cache = (digest: string) => ({
      "Cache-Control": "private, max-age=300",
      ETag: `"${digest}"`,
      "X-Content-Type-Options": "nosniff",
    });
    // Revalidation reads only digests, never the image bytes.
    const known = await runAssetDigest(database(), session.uid, id, size);
    if (known && request.headers.get("if-none-match") === `"${known}"`)
      return new Response(null, { status: 304, headers: cache(known) });
    const { bytes, mime, digest } = await readRunAsset(
      database(),
      session.uid,
      id,
      size,
    );
    const headers = cache(digest);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": "inline",
      },
    });
  });
}
