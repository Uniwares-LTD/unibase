import "server-only";
import sharp from "sharp";
import { AppError } from "@/lib/auth-policy";
export async function validatedImage(
  base64: string,
  limit = 8 * 1024 * 1024,
  pixels = 16_000_000,
) {
  const input = Buffer.from(base64, "base64");
  if (
    !input.length ||
    input.length > limit ||
    input.toString("base64") !== base64
  )
    throw new AppError(
      "INVALID_IMAGE",
      `Use a PNG, JPEG or WebP image no larger than ${limit / 1024 / 1024} MiB.`,
    );
  try {
    // libvips can decode only the default image of APNG. Reject its animation
    // control chunk explicitly rather than silently discarding other frames.
    if (
      input
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      for (let offset = 8; offset + 12 <= input.length;) {
        const length = input.readUInt32BE(offset);
        const type = input.toString("ascii", offset + 4, offset + 8);
        if (type === "acTL") throw new Error("Animated PNG");
        if (length > input.length - offset - 12)
          throw new Error("Truncated PNG");
        offset += length + 12;
        if (type === "IEND") break;
      }
    }
    const source = sharp(input, {
      limitInputPixels: pixels,
      failOn: "warning",
      animated: true,
    });
    const meta = await source.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) !== 1 ||
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > pixels
    )
      throw new Error("Unsupported image");
    // Full decode, strip metadata, normalize format; never serve the uploaded bytes.
    const bytes = await source.rotate().png().toBuffer();
    if (bytes.length > limit) throw new Error("Normalized image too large");
    return { bytes, mime: "image/png" };
  } catch {
    throw new AppError(
      "INVALID_IMAGE",
      `Use a valid, single-frame PNG, JPEG or WebP that normalizes to at most ${limit / 1024 / 1024} MiB.`,
    );
  }
}
