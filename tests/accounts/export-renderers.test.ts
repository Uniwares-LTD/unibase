import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import {
  archiveRenderer,
  type ExportRenderContext,
} from "../../src/lib/server/workspaces/export-renderers";
import type { ExportSnapshot } from "../../src/lib/contracts/export";

test("ZIP export packages exact snapshot content and private assets with safe paths", async () => {
  const assetId = randomUUID(),
    artifactId = randomUUID();
  const bytes = Buffer.from("owned normalized image fixture");
  const snapshot: ExportSnapshot = {
    schemaVersion: 1,
    workspaceId: randomUUID(),
    title: "../Example فارسی",
    capturedAt: new Date().toISOString(),
    artifacts: [
      {
        artifactId,
        approval: null,
        version: {
          number: 3,
          title: "../../Unsafe title",
          body: "Unicode content: سلام 🌱",
          assetId,
          dependencies: [],
          createdAt: new Date().toISOString(),
          sourceJobId: null,
          decisionFingerprint: null,
        },
      },
    ],
    assets: [
      {
        id: assetId,
        name: "../../outside.png",
        mime: "image/png",
        bytes: bytes.length,
        digest: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  const progress: number[] = [];
  const context: ExportRenderContext = {
    snapshot,
    maxBytes: 8 * 1024 * 1024,
    signal: new AbortController().signal,
    readAsset: async (id) => {
      assert.equal(id, assetId);
      return bytes;
    },
    progress: async (value) => {
      progress.push(value);
    },
  };
  const result = await archiveRenderer.render(context);
  const files = unzipSync(result);
  assert.deepEqual(
    Object.keys(files).sort(),
    [
      "manifest.json",
      `artifacts/${artifactId}/v3.json`,
      `artifacts/${artifactId}/v3.txt`,
      `assets/${assetId}.png`,
    ].sort(),
  );
  assert.deepEqual(JSON.parse(strFromU8(files["manifest.json"])), snapshot);
  assert.match(strFromU8(files[`artifacts/${artifactId}/v3.txt`]), /سلام 🌱/);
  assert.deepEqual(Buffer.from(files[`assets/${assetId}.png`]), bytes);
  assert.deepEqual(await archiveRenderer.render(context), result);
  assert.ok(progress.includes(80));
  await assert.rejects(
    archiveRenderer.render({
      ...context,
      readAsset: async () => Buffer.from("changed"),
    }),
    /saved identity/,
  );
  await assert.rejects(
    archiveRenderer.render({ ...context, maxBytes: 1 }),
    /storage limit/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    archiveRenderer.render({ ...context, signal: cancelled.signal }),
    { name: "AbortError" },
  );
});
