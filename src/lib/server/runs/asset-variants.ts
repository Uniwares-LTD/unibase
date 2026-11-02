import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Display copies of a normalized result image. The original PNG stays the
// reference; variants are smaller WebP renditions for lists and viewers.
export const assetSizes = {
  thumb: { width: 400, quality: 72 },
  preview: { width: 1280, quality: 80 },
} as const;
export type AssetSize = keyof typeof assetSizes;
export type AssetVariant = {
  mime: "image/webp";
  bytes: number;
  digest: string;
  width: number;
  height: number;
  base64: string;
};
export type AssetVariants = Partial<Record<AssetSize, AssetVariant>>;

// Input is already validated and normalized. A size is omitted when it would
// not be smaller than the original; callers then serve the original.
export async function buildAssetVariants(original: Buffer) {
  const variants: AssetVariants = {};
  for (const [size, { width, quality }] of Object.entries(assetSizes)) {
    const { data, info } = await sharp(original)
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    if (data.length >= original.length) continue;
    variants[size as AssetSize] = {
      mime: "image/webp",
      bytes: data.length,
      digest: createHash("sha256").update(data).digest("hex"),
      width: info.width,
      height: info.height,
      base64: data.toString("base64"),
    };
  }
  return variants;
}
