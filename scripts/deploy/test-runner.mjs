import { spawnSync } from "node:child_process";
import path from "node:path";

// Fixed, disposable Linux container. No VPS, host secrets or production services.
for (const args of [
  ["build", "-t", "unitale-deployment-tests", "tests/deploy"],
  [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${path.resolve(".")},target=/repo,readonly`,
    "unitale-deployment-tests",
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
