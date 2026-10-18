import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
const password = randomBytes(32).toString("base64url");
const image =
  "redis@sha256:3811787313eba226a2ef38658c6ccb91cd5e110edc89c37767de373120a0e5a0";
const run = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-d",
    "-p",
    "127.0.0.1::6379",
    image,
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
    "--requirepass",
    password,
  ],
  { encoding: "utf8", windowsHide: true },
);
if (run.status) throw new Error("Could not start owned Redis fixture.");
const id = run.stdout.trim();
if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid fixture identity.");
try {
  const port = spawnSync("docker", ["port", id, "6379/tcp"], {
    encoding: "utf8",
    windowsHide: true,
  }).stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(port))
    throw new Error("Invalid fixture port.");
  const test = spawn(
    process.execPath,
    [
      "scripts/integration.mjs",
      "--ai",
      "--rate-limits",
      ...process.argv.slice(2),
    ],
    {
      env: {
        ...process.env,
        REDIS_URL: `redis://default:${password}@${port}`,
        RATE_LIMITS_JSON: '{"read":3}',
        RATE_TEST_FIXTURE: id,
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  const [code] = await once(test, "exit");
  process.exitCode = code ?? 1;
} finally {
  spawnSync("docker", ["rm", "-f", id], { stdio: "ignore", windowsHide: true });
}
