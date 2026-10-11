import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoClient } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { parseDifyConfig } from "../../src/lib/config/dify";
import {
  createDifyFiles,
  resolveOwnedAiFile,
  uploadOwnedAiFile,
  validateAiFile,
} from "../../src/lib/server/ai/files";
import type { BindingSnapshot } from "../../src/lib/server/ai/jobs";

const binding: BindingSnapshot = {
  name: "document-summary",
  revision: "1",
  kind: "workflow",
  mode: "fake",
  fingerprint: "fixture",
};
const actor = { uid: "owner", authTime: Math.floor(Date.now() / 1000) };
const providerId = "00000000-0000-4000-8000-000000000001";

test("file adapter uses multipart boundaries and opaque user identity, with bounded validated responses", async () => {
  const config = parseDifyConfig({
    DIFY_MODE: "live",
    DIFY_BASE_URL: "https://dify.example.test/v1",
    DIFY_ORCHESTRATORS_JSON: JSON.stringify([
      {
        id: "document-summary",
        name: "Document summary",
        description: "",
        order: 0,
        enabled: true,
        keyEnv: "DIFY_KEY_DOC",
        inputs: [],
        pricing: null,
        recovery: null,
      },
    ]),
    DIFY_KEY_DOC: "secret",
  });
  assert.equal(config.mode, "live");
  if (config.mode !== "live") return;
  const client = createDifyFiles(
    config,
    config.bindings[0],
    async (url, options) => {
      assert.equal(url, "https://dify.example.test/v1/files/upload");
      assert.equal(options?.redirect, "error");
      assert.ok(options?.body instanceof FormData);
      assert.equal(new Headers(options.headers).get("content-type"), null);
      assert.equal(options.body.get("user"), "opaque-user");
      return Response.json({ id: providerId, size: 5 });
    },
  );
  const result = await client.upload(
    new File(["hello"], "notes.txt", { type: "text/plain" }),
    "opaque-user",
  );
  assert.deepEqual(result, { kind: "ok", value: { id: providerId } });
  assert.throws(() =>
    validateAiFile({ name: "../bad.txt", type: "text/plain", size: 1 }),
  );
  assert.throws(() =>
    validateAiFile({ name: "bad.svg", type: "image/svg+xml", size: 1 }),
  );
  assert.throws(() =>
    validateAiFile({
      name: "huge.txt",
      type: "text/plain",
      size: 21 * 1024 * 1024,
    }),
  );
});

test("owned files are deduplicated and cannot cross users, bindings or file types", async () => {
  const repl = await MongoMemoryReplSet.create({
    binary: { downloadDir: ".cache/mongodb-binaries" },
    replSet: { count: 1 },
  });
  const client = new MongoClient(repl.getUri());
  try {
    const db = client.db("ai_files");
    let uploads = 0;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const upload = async () => {
      uploads++;
      return { kind: "ok" as const, value: { id: providerId } };
    };
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        uploadOwnedAiFile(db, actor, "duplicate", binding, file, upload),
      ),
    );
    assert.equal(uploads, 1);
    assert.equal(new Set(results.map((item) => item._id)).size, 1);
    const saved = await uploadOwnedAiFile(
      db,
      actor,
      "duplicate",
      binding,
      file,
      upload,
    );
    assert.equal(saved.status, "ready");
    assert.deepEqual(
      await resolveOwnedAiFile(db, actor.uid, binding, saved._id, ["document"]),
      {
        type: "document",
        transfer_method: "local_file",
        upload_file_id: providerId,
      },
    );
    await assert.rejects(
      resolveOwnedAiFile(db, "other-user", binding, saved._id, ["document"]),
      { code: "AI_FILE_NOT_FOUND" },
    );
    await assert.rejects(
      resolveOwnedAiFile(
        db,
        actor.uid,
        { ...binding, fingerprint: "changed" },
        saved._id,
        ["document"],
      ),
      { code: "AI_FILE_NOT_FOUND" },
    );
    await assert.rejects(
      resolveOwnedAiFile(db, actor.uid, binding, saved._id, ["image"]),
      { code: "AI_FILE_NOT_FOUND" },
    );
    await assert.rejects(
      uploadOwnedAiFile(
        db,
        actor,
        "duplicate",
        binding,
        new File(["different"], "notes.txt", { type: "text/plain" }),
        upload,
      ),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    let attempts = 0;
    const unknown = async () => {
      attempts++;
      return { kind: "unknown" as const, failure: "transport" as const };
    };
    const unresolved = await uploadOwnedAiFile(
      db,
      actor,
      "uncertain",
      binding,
      file,
      unknown,
    );
    assert.equal(unresolved.status, "unknown");
    await uploadOwnedAiFile(db, actor, "uncertain", binding, file, unknown);
    assert.equal(attempts, 1);
    await assert.rejects(
      resolveOwnedAiFile(db, actor.uid, binding, unresolved._id, ["document"]),
      { code: "AI_FILE_NOT_FOUND" },
    );
  } finally {
    await client.close();
    await repl.stop();
  }
});
