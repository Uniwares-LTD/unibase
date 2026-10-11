import "server-only";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { AppError } from "@/lib/auth-policy";
import { OBJECT_ASSET_LIMIT, type AssetConfig } from "@/lib/config/assets";

export type ObjectReference = {
  storeId: string;
  key: string;
  versionId?: string;
};
export type ObjectInfo = { bytes: number; digest: string; versionId?: string };
export interface PrivateObjectStore {
  id: string;
  key: (stageId: string) => string;
  put: (
    key: string,
    bytes: Buffer,
    mime: string,
    digest: string,
  ) => Promise<ObjectReference>;
  get: (reference: ObjectReference, expected: ObjectInfo) => Promise<Buffer>;
  head: (reference: ObjectReference) => Promise<ObjectInfo | null>;
  remove: (reference: ObjectReference) => Promise<void>;
}
type S3Config = Extract<AssetConfig, { mode: "s3" }>;
export const objectStoreId = (config: S3Config) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.endpoint,
        config.region,
        config.bucket,
        config.prefix,
      ]),
    )
    .digest("hex");
const unavailable = () =>
  new AppError(
    "ASSET_STORAGE_UNAVAILABLE",
    "Private storage is unavailable. Check its configuration or try again.",
    503,
  );
const notFound = (error: unknown) =>
  !!error &&
  typeof error === "object" &&
  "$metadata" in error &&
  (error.$metadata as { httpStatusCode?: number }).httpStatusCode === 404;
export function s3ObjectStore(config: S3Config): PrivateObjectStore {
  const id = objectStoreId(config);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const validate = (reference: ObjectReference) => {
    if (
      reference.storeId !== id ||
      !new RegExp(`^${config.prefix}/[a-f0-9-]{36}$`).test(reference.key)
    )
      throw unavailable();
  };
  const options = () => ({ abortSignal: AbortSignal.timeout(30_000) });
  const head = async (
    reference: ObjectReference,
  ): Promise<ObjectInfo | null> => {
    validate(reference);
    try {
      const found = await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: reference.key,
          VersionId: reference.versionId,
        }),
        options(),
      );
      if (!found.ContentLength || !found.Metadata?.sha256) throw unavailable();
      return {
        bytes: found.ContentLength,
        digest: found.Metadata.sha256,
        ...(found.VersionId && found.VersionId !== "null"
          ? { versionId: found.VersionId }
          : {}),
      };
    } catch (error) {
      if (notFound(error)) return null;
      throw unavailable();
    }
  };
  return {
    id,
    key: (stageId) => `${config.prefix}/${stageId}`,
    async put(key, bytes, mime, digest) {
      validate({ storeId: id, key });
      try {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: bytes,
            ContentType: mime,
            ContentLength: bytes.length,
            Metadata: { sha256: digest },
            IfNoneMatch: "*",
          }),
          options(),
        );
        return {
          storeId: id,
          key,
          ...(result.VersionId && result.VersionId !== "null"
            ? { versionId: result.VersionId }
            : {}),
        };
      } catch {
        throw unavailable();
      }
    },
    async get(reference, expected) {
      validate(reference);
      if (
        !Number.isSafeInteger(expected.bytes) ||
        expected.bytes <= 0 ||
        expected.bytes > OBJECT_ASSET_LIMIT
      )
        throw unavailable();
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: reference.key,
            VersionId: reference.versionId,
          }),
          options(),
        );
        if (!result.Body) throw unavailable();
        const reader = result.Body.transformToWebStream().getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          if (result.ContentLength !== expected.bytes) throw unavailable();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > expected.bytes) throw unavailable();
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const bytes = Buffer.concat(chunks);
        if (
          bytes.length !== expected.bytes ||
          createHash("sha256").update(bytes).digest("hex") !== expected.digest
        )
          throw unavailable();
        return bytes;
      } catch {
        throw unavailable();
      }
    },
    head,
    async remove(reference) {
      validate(reference);
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: reference.key,
            VersionId: reference.versionId,
          }),
          options(),
        );
      } catch (error) {
        if (notFound(error)) return;
        throw unavailable();
      }
    },
  };
}
