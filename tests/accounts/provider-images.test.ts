import assert from "node:assert/strict";
import { test } from "node:test";
import {
  downloadProviderImage,
  providerImages,
} from "../../src/lib/server/runs/provider-images";

const id = "00000000-0000-4000-8000-000000000001";
const file = {
  type: "image" as const,
  transfer_method: "tool_file" as const,
  related_id: id,
  url: `/files/tools/${id}.png?timestamp=123&nonce=nonce&sign=signature`,
};
const origin = "https://dify.example.test/v1";
const result = {
  version: 1,
  outcome: "success",
  text: "Panel",
  cards: [],
  images: [],
};

test("native provider images require explicit, bounded image outputs", () => {
  assert.deepEqual(providerImages({ result: "ordinary result" }), []);
  assert.deepEqual(providerImages({ result, unibase_images: [file] }), [file]);
  assert.throws(() => providerImages({ unibase_images: [file] }));
  for (const images of [
    [],
    [{ ...file, type: "document" }],
    [{ ...file, transfer_method: "remote_url" }],
    Array(11).fill(file),
  ])
    assert.throws(() => providerImages({ result, unibase_images: images }));
});

test("signed Dify images stay on the configured file origin with no service credentials or redirects", async () => {
  const bytes = Buffer.from("image bytes");
  const fetched: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    fetched.push(String(url));
    assert.equal(options?.redirect, "error");
    assert.equal(options?.headers, undefined);
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  };
  assert.deepEqual(
    await downloadProviderImage(file, origin, 100, fetcher),
    bytes,
  );
  for (const url of [
    "https://other.example.test" + file.url,
    "http://127.0.0.1" + file.url,
    "https://user:password@dify.example.test" + file.url,
    "/console/api/apps?timestamp=123&nonce=n&sign=s",
    file.url.replace(id, "00000000-0000-4000-8000-000000000002"),
    file.url + "&url=http://127.0.0.1",
    file.url + "&sign=other",
    file.url.replace("&sign=signature", ""),
    file.url + "#fragment",
  ])
    await assert.rejects(
      downloadProviderImage({ ...file, url }, origin, 100, fetcher),
    );
  assert.equal(fetched.length, 1);
});

test("native provider image downloads enforce byte and MIME bounds", async () => {
  await assert.rejects(
    downloadProviderImage(
      file,
      origin,
      2,
      async () =>
        new Response("long bytes", {
          headers: { "content-type": "image/png" },
        }),
    ),
    /size limit/,
  );
  await assert.rejects(
    downloadProviderImage(
      file,
      origin,
      100,
      async () =>
        new Response("html", { headers: { "content-type": "text/html" } }),
    ),
    /format/,
  );
  await assert.rejects(
    downloadProviderImage(
      file,
      origin,
      100,
      async () => new Response(null, { status: 403 }),
    ),
    /unavailable/,
  );
});
