// Run in an owned local container with unavailable local-only dependencies.
(async () => {
  const { default: assert } = await import("node:assert/strict");
  const fs = await import("node:fs");
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
  assert.equal((await fetch("http://127.0.0.1:3000/offline.html")).status, 200);
  console.log(
    "Non-root runtime, dependency exclusion, health boundaries and public assets passed.",
  );
})().catch(() => {
  console.error("Container smoke check failed.");
  process.exitCode = 1;
});
