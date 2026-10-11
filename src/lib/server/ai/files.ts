import "server-only";
import { readSettings } from "../settings";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "mongodb";
import { AppError } from "@/lib/auth-policy";
import type { CreditActor } from "../store/credit-types";
import { readWallet } from "../store/credits";
import { fingerprint, type BindingSnapshot } from "./jobs";
import {
  createDifyRequest,
  failure,
  httpFailure,
  providerUser,
  readJson,
  type Binding,
  type LiveConfig,
} from "./dify";
import type { ProviderOutcome } from "./types";

export const AI_FILE_LIMIT = 20 * 1024 * 1024;
const mimeTypes = {
  "text/plain": "document",
  "application/pdf": "document",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "audio/mpeg": "audio",
  "audio/wav": "audio",
  "video/mp4": "video",
} as const;
export type AiFileType = (typeof mimeTypes)[keyof typeof mimeTypes];
export type AiFile = {
  _id: string;
  uid: string;
  binding: BindingSnapshot;
  name: string;
  mimeType: string;
  type: AiFileType;
  bytes: number;
  sha256: string;
  fingerprint: string;
  status: "uploading" | "ready" | "failed" | "unknown";
  providerFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
  cleanedAt?: Date;
};
export const aiFiles = (db: Db) => db.collection<AiFile>("aiFiles");
export function validateAiFile(file: {
  name: string;
  type: string;
  size: number;
}) {
  if (
    !file.name ||
    file.name.length > 200 ||
    /[\x00-\x1f\x7f/\\]/.test(file.name)
  )
    throw new AppError(
      "AI_FILE_NAME",
      "Use a filename without path separators or control characters.",
    );
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > AI_FILE_LIMIT
  )
    throw new AppError(
      "AI_FILE_SIZE",
      "Choose a file between 1 byte and 20 MiB.",
      413,
    );
  if (!Object.hasOwn(mimeTypes, file.type))
    throw new AppError("AI_FILE_TYPE", "This file type is not supported.", 415);
  return mimeTypes[file.type as keyof typeof mimeTypes];
}

export function createDifyFiles(
  config: LiveConfig,
  binding: Binding,
  fetcher: typeof fetch = fetch,
) {
  const request = createDifyRequest(config, binding, fetcher);
  return {
    async upload(
      file: File,
      user: string,
      signal?: AbortSignal,
    ): Promise<ProviderOutcome<{ id: string }>> {
      validateAiFile(file);
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("user", user);
      let response: Response;
      try {
        response = await request("/files/upload", form, signal);
      } catch (error) {
        return { kind: "unknown", failure: failure(error) };
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return httpFailure(response, true);
      }
      try {
        const uploaded = z
          .object({ id: z.string().uuid(), size: z.number().int().positive() })
          .parse(await readJson(response, 64 * 1024));
        if (uploaded.size !== file.size)
          return { kind: "unknown", failure: "invalid-response" };
        return { kind: "ok", value: { id: uploaded.id } };
      } catch {
        return { kind: "unknown", failure: "invalid-response" };
      }
    },
  };
}

// This stores owned provider references, not a public asset CDN. Feature-owned
// permanent artifacts must copy bytes into their chosen private asset store.
export async function uploadOwnedAiFile(
  db: Db,
  actor: CreditActor,
  key: string,
  binding: BindingSnapshot,
  file: File,
  upload: (
    file: File,
    user: string,
  ) => Promise<ProviderOutcome<{ id: string }>>,
) {
  const type = validateAiFile(file);
  const policy = (await readSettings(db)).settings.runs;
  if (file.size > policy.uploadBytes)
    throw new AppError(
      "AI_FILE_LIMIT",
      "File exceeds the configured upload limit.",
      413,
    );
  if (!/^[A-Za-z0-9_:-]{1,128}$/.test(key))
    throw new AppError("AI_INVALID_KEY", "Invalid upload request key.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const id = fingerprint(["file", actor.uid, key]);
  const requestHash = fingerprint([
    binding.fingerprint,
    file.name,
    file.type,
    file.size,
    sha256,
  ]);
  let created = false;
  let saved: AiFile | null = null;
  await readWallet(db, actor.uid, {
    actor,
    persist: async (session) => {
      created = false;
      const prior = await aiFiles(db).findOne({ _id: id }, { session });
      if (prior) {
        if (prior.fingerprint !== requestHash)
          throw new AppError(
            "IDEMPOTENCY_CONFLICT",
            "This upload key was already used for a different file.",
            409,
          );
        saved = prior;
        return;
      }
      const owned = await aiFiles(db)
        .find(
          { uid: actor.uid, cleanedAt: { $exists: false } },
          { session, projection: { bytes: 1 } },
        )
        .limit(101)
        .toArray();
      if (
        owned.length >= policy.filesPerAccount ||
        owned.reduce((sum, item) => sum + item.bytes, 0) + bytes.length >
          policy.uploadBytesPerAccount
      )
        throw new AppError(
          "AI_FILE_QUOTA",
          "Your AI upload allowance is full. Contact an administrator.",
          409,
        );
      const now = new Date();
      saved = {
        _id: id,
        uid: actor.uid,
        binding,
        name: file.name,
        mimeType: file.type,
        type,
        bytes: bytes.length,
        sha256,
        fingerprint: requestHash,
        status: "uploading",
        providerFileId: null,
        createdAt: now,
        updatedAt: now,
      };
      await aiFiles(db).insertOne(saved, { session });
      created = true;
    },
  });
  if (!created) return saved! as AiFile;
  // An interrupted upload is not automatically re-sent. Its bytes may already
  // exist at the provider; the same key returns the durable unresolved record.
  const result = await upload(file, providerUser(actor.uid));
  const updated = await aiFiles(db).findOneAndUpdate(
    { _id: id, uid: actor.uid, status: "uploading" },
    {
      $set: {
        status:
          result.kind === "ok"
            ? "ready"
            : result.kind === "rejected"
              ? "failed"
              : "unknown",
        providerFileId: result.kind === "ok" ? result.value.id : null,
        updatedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!updated)
    throw new AppError(
      "AI_FILE_CHANGED",
      "The upload changed. Refresh its status.",
      409,
    );
  return updated;
}

export async function resolveOwnedAiFile(
  db: Db,
  uid: string,
  binding: BindingSnapshot,
  id: string,
  allowed: readonly AiFileType[],
) {
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new AppError("AI_FILE_NOT_FOUND", "AI file was not found.", 404);
  const file = await aiFiles(db).findOne({
    _id: id,
    uid,
    "binding.fingerprint": binding.fingerprint,
    status: "ready",
  });
  if (!file?.providerFileId || !allowed.includes(file.type))
    throw new AppError(
      "AI_FILE_NOT_FOUND",
      "AI file is unavailable for this capability.",
      404,
    );
  return {
    type: file.type,
    transfer_method: "local_file" as const,
    upload_file_id: file.providerFileId,
  };
}

export async function createAiFileIndexes(db: Db) {
  await aiFiles(db).createIndex({ uid: 1, createdAt: -1 });
}
