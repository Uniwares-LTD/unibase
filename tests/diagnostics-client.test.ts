import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

test("diagnostics helper uses copied access details without exposing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "diagnostic-client-"));
  const credential = `${randomBytes(16).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    assert.equal(request.url, "/api/diagnostics");
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
      capability: "capabilities.list",
      payload: {},
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: { ok: true } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/diagnostics`;
  async function run(details: string) {
    const file = join(directory, "access");
    await writeFile(file, details, { mode: 0o600 });
    const child = spawn(
      process.execPath,
      [
        "scripts/diagnostics-client.mjs",
        "--access-file",
        file,
        "--capability",
        "capabilities.list",
      ],
      { windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const [code] = await once(child, "exit");
    assert.ok(!output.includes(credential));
    return { code, output };
  }
  try {
    const valid = await run(
      `Diagnostic endpoint: ${endpoint} | Authorization: Bearer ${credential}`,
    );
    assert.equal(valid.code, 0, valid.output);
    assert.deepEqual(JSON.parse(valid.output), { data: { ok: true } });
    for (const invalid of [
      `Diagnostic endpoint: ${endpoint}?redirect=yes | Authorization: Bearer ${credential}`,
      `Diagnostic endpoint: http://example.test/api/diagnostics | Authorization: Bearer ${credential}`,
      "incomplete access details",
    ]) {
      assert.notEqual((await run(invalid)).code, 0);
    }
    assert.equal(requests, 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
