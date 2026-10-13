import assert from "node:assert/strict";
import { test } from "node:test";
import { readMultipart } from "../src/lib/upload-body";

test("multipart limit applies to the file as well as total bytes", async () => {
  const form = new FormData();
  form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const request = () =>
    new Request("http://localhost/upload", { method: "POST", body: form });
  assert.equal(
    (await readMultipart(request(), 5)).get("file") instanceof File,
    true,
  );
  await assert.rejects(readMultipart(request(), 4), {
    code: "FILE_TOO_LARGE",
    status: 413,
  });
});

test("stalled and disconnected uploads cancel without awaiting the source", async () => {
  for (const disconnected of [false, true]) {
    let cancelled = false;
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise<void>(() => {});
      },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { "content-type": "multipart/form-data; boundary=test" },
      duplex: "half",
    } as RequestInit);
    const reading = readMultipart(request, 10, 20);
    if (disconnected) controller.abort();
    await assert.rejects(reading, { status: disconnected ? 400 : 408 });
    assert.equal(cancelled, true);
  }
});

test("chunked overflow is cancelled and malformed multipart is a caller error", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(1024 * 1024 + 2));
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = { "content-type": "multipart/form-data; boundary=test" };
  await assert.rejects(
    readMultipart(
      new Request("http://localhost/upload", {
        method: "POST",
        body,
        headers,
        duplex: "half",
      } as RequestInit),
      1,
    ),
    { status: 413 },
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    readMultipart(
      new Request("http://localhost/upload", {
        method: "POST",
        body: "broken",
        headers,
      }),
      10,
    ),
    { code: "INVALID_INPUT", status: 400 },
  );
});
