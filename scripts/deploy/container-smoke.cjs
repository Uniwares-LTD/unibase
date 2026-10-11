// Run in an owned local container with unavailable local-only dependencies.
(async () => {
  const { default: assert } = await import("node:assert/strict");
  const fs = await import("node:fs");
  const { createRequire } = await import("node:module");
  const load = createRequire(__filename);
  assert.equal(process.getuid(), 1001);
  assert.equal(
    fs.readdirSync("/app").some((name) => name.startsWith(".env")),
    false,
  );
  for (const name of [
    "typescript",
    "eslint",
    "firebase-tools",
    "mongodb-memory-server",
    "@bubblewrap/core",
  ]) {
    assert.equal(
      fs.existsSync(`/app/node_modules/${name}`),
      false,
      `Development tool in runtime: ${name}`,
    );
  }
  for (const name of [
    "payment-worker.cjs",
    "ai-worker.cjs",
    "worker-healthcheck.cjs",
  ]) {
    assert.ok(fs.statSync(`/app/${name}`).size > 0, `Missing worker: ${name}`);
  }
  assert.ok(require.resolve("sharp"));
  const image = await load("sharp")({
    create: { width: 2, height: 2, channels: 4, background: "white" },
  })
    .png()
    .toBuffer();
  assert.equal((await load("sharp")(image).metadata()).format, "png");
  for (const [route, status] of [
    ["live", 200],
    ["ready", 503],
  ]) {
    const response = await fetch(`http://127.0.0.1:3000/api/health/${route}`);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body, {
      status: route === "live" ? "live" : "unavailable",
    });
    console.log(route, status, body.status);
  }
  assert.equal((await fetch("http://127.0.0.1:3000/account")).status, 200);
  const offline = await fetch("http://127.0.0.1:3000/offline.html");
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /<title>Offline<\/title>/);
  console.log(
    "Non-root runtime, dependency exclusion, health boundaries and public assets passed.",
  );
})().catch(() => {
  console.error("Container smoke check failed.");
  process.exitCode = 1;
});
