import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  s3ObjectStore,
  objectStoreId,
} from "../../src/lib/server/runs/object-store";
import type { AssetConfig } from "../../src/lib/config/assets";

test("S3 adapter uses conditional writes, bounded verified reads and exact-version deletion", async () => {
  const objects = new Map<
    string,
    { bytes: Buffer; digest: string; version: string }
  >();
  let gets = 0;
  let requests = 0;
  let corrupt = false;
  let oversized = false;
  const server = createServer(async (req, res) => {
    requests++;
    const url = new URL(req.url!, "http://fixture");
    if (req.method === "PUT") {
      assert.equal(req.headers["if-none-match"], "*");
      if (objects.has(url.pathname)) {
        res.writeHead(412).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(url.pathname, {
        bytes: Buffer.concat(chunks),
        digest: String(req.headers["x-amz-meta-sha256"]),
        version: "version-one",
      });
      res
        .writeHead(200, {
          "x-amz-version-id": "version-one",
          etag: '"fixture"',
        })
        .end();
      return;
    }
    const value = objects.get(url.pathname);
    if (!value) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "HEAD") {
      res
        .writeHead(200, {
          "content-length": value.bytes.length,
          "x-amz-meta-sha256": value.digest,
          "x-amz-version-id": value.version,
        })
        .end();
      return;
    }
    assert.equal(url.searchParams.get("versionId"), value.version);
    if (req.method === "GET") {
      gets++;
      const bytes = corrupt ? Buffer.alloc(value.bytes.length, 1) : value.bytes;
      res.writeHead(200, {
        "content-length": oversized ? bytes.length + 1 : bytes.length,
      });
      res.end(oversized ? Buffer.concat([bytes, Buffer.from("x")]) : bytes);
    } else if (req.method === "DELETE") {
      objects.delete(url.pathname);
      res.writeHead(204).end();
    } else res.writeHead(405).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config: Extract<AssetConfig, { mode: "s3" }> = {
    mode: "s3",
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    region: "us-east-1",
    bucket: "test-assets",
    prefix: "private",
    accessKeyId: "fixture",
    secretAccessKey: "fixture",
    forcePathStyle: true,
  };
  try {
    const store = s3ObjectStore(config);
    assert.equal(
      objectStoreId(config),
      objectStoreId({ ...config, secretAccessKey: "rotated" }),
    );
    assert.notEqual(
      store.id,
      objectStoreId({ ...config, bucket: "another-bucket" }),
    );
    const bytes = Buffer.alloc(9 * 1024 * 1024, 42);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const key = store.key(randomUUID());
    const ref = await store.put(key, bytes, "application/octet-stream", digest);
    assert.equal(ref.versionId, "version-one");
    const beforeDuplicate = requests;
    await assert.rejects(
      store.put(key, bytes, "application/octet-stream", digest),
      /Private storage is unavailable/,
    );
    assert.equal(
      requests - beforeDuplicate,
      1,
      "unknown write must not be retried automatically",
    );
    assert.deepEqual(await store.head(ref), {
      bytes: bytes.length,
      digest,
      versionId: "version-one",
    });
    assert.deepEqual(
      await store.get(ref, { bytes: bytes.length, digest }),
      bytes,
    );
    corrupt = true;
    await assert.rejects(store.get(ref, { bytes: bytes.length, digest }));
    corrupt = false;
    oversized = true;
    await assert.rejects(store.get(ref, { bytes: bytes.length, digest }));
    oversized = false;
    const beforeInvalid = gets;
    for (const count of [0, -1, Infinity, 65 * 1024 * 1024])
      await assert.rejects(store.get(ref, { bytes: count, digest }));
    await assert.rejects(
      store.get({ ...ref, storeId: "other" }, { bytes: bytes.length, digest }),
    );
    await assert.rejects(
      store.get({ ...ref, key: "../outside" }, { bytes: bytes.length, digest }),
    );
    assert.equal(gets, beforeInvalid);
    await store.remove(ref);
    assert.equal(await store.head(ref), null);
    await store.remove(ref); // A crash after deletion is safe to replay.
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
