import { spawnSync } from "node:child_process";
import path from "node:path";
import manifest from "../../project.config.json" with { type: "json" };
const image = `${manifest.slug}-deployment-tests`;

// Fixed, disposable Linux container. No VPS, host secrets or production services.
for (const args of [
  ["build", "-t", image, "tests/deploy"],
  [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${path.resolve(".")},target=/repo,readonly`,
    image,
  ],
]) {
  const result = spawnSync("docker", args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
