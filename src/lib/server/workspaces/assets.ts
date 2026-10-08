import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ClientSession, Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";

export type PrivateAsset = {
  _id: string;
  uid: string;
  workspaceId: string;
  name: string;
  mime: string;
  bytes: number;
  digest: string;
  base64: string;
  createdAt: Date;
};
// Immutable adapter boundary. Metadata and bytes commit together with the workspace.
// An object-store implementation must stage bytes before the database transaction.
export interface PrivateAssetStore {
  put(asset: PrivateAsset, session: ClientSession): Promise<void>;
  get(uid: string, id: string): Promise<PrivateAsset | null>;
}
export function mongoAssetStore(db: Db): PrivateAssetStore {
  const collection = db.collection<PrivateAsset>("workspaceAssets");
  return {
    async put(asset, session) {
      await collection.insertOne(asset, { session });
    },
    get: (uid, id) => collection.findOne({ _id: id, uid }),
  };
}
export async function validatedImage(base64: string, limit = 1024 * 1024) {
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
      limitInputPixels: 16_000_000,
      failOn: "warning",
      animated: true,
    });
    const meta = await source.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) !== 1 ||
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > 16_000_000
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
export function assetRecord(
  id: string,
  uid: string,
  workspaceId: string,
  name: string,
  bytes: Buffer,
  mime: string,
): PrivateAsset {
  return {
    _id: id,
    uid,
    workspaceId,
    name,
    mime,
    bytes: bytes.length,
    digest: createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
    createdAt: new Date(),
  };
}
