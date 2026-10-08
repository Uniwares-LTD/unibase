export const MONGO_ASSET_LIMIT = 8 * 1024 * 1024;
export const OBJECT_ASSET_LIMIT = 64 * 1024 * 1024;
export const IMAGE_PIXEL_LIMIT = 16_000_000;
export type AssetConfig =
  | { mode: "mongo" }
  | {
      mode: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
    };
// Only server modules pass process.env. Error messages never include input values.
export function parseAssetConfig(
  env: Record<string, string | undefined>,
): AssetConfig {
  const mode = env.ASSET_STORE ?? "mongo";
  if (mode === "mongo") return { mode };
  if (mode !== "s3") throw new Error("Invalid ASSET_STORE.");
  try {
    const endpoint = new URL(env.ASSET_S3_ENDPOINT ?? "");
    const local =
      (env.APP_ENV ?? "local") === "local" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
    if (
      (endpoint.protocol !== "https:" &&
        !(local && endpoint.protocol === "http:")) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/"
    )
      throw new Error();
    const region = env.ASSET_S3_REGION ?? "";
    const bucket = env.ASSET_S3_BUCKET ?? "";
    const prefix = env.ASSET_S3_PREFIX ?? "workspace-assets";
    const accessKeyId = env.ASSET_S3_ACCESS_KEY_ID ?? "";
    const secretAccessKey = env.ASSET_S3_SECRET_ACCESS_KEY ?? "";
    if (
      !/^[a-z0-9-]{1,64}$/.test(region) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes("..") ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(prefix) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(accessKeyId) ||
      !secretAccessKey ||
      secretAccessKey.length > 1024 ||
      /[\s\x00-\x1f\x7f]/.test(secretAccessKey) ||
      ![undefined, "true", "false"].includes(env.ASSET_S3_FORCE_PATH_STYLE)
    )
      throw new Error();
    return {
      mode,
      endpoint: endpoint.origin,
      region,
      bucket,
      prefix,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env.ASSET_S3_FORCE_PATH_STYLE !== "false",
    };
  } catch {
    throw new Error(
      "Invalid private asset configuration: check ASSET_S3_ENDPOINT, ASSET_S3_REGION, ASSET_S3_BUCKET, ASSET_S3_PREFIX, ASSET_S3_ACCESS_KEY_ID, ASSET_S3_SECRET_ACCESS_KEY and ASSET_S3_FORCE_PATH_STYLE.",
    );
  }
}
export const assetByteLimit = (config: AssetConfig) =>
  config.mode === "s3" ? OBJECT_ASSET_LIMIT : MONGO_ASSET_LIMIT;
export const imageByteLimit = (config: AssetConfig) =>
  Math.min(assetByteLimit(config), 20 * 1024 * 1024);
