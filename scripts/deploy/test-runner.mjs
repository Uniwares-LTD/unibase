import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import manifest from "../../project.config.json" with { type: "json" };
const image = `${manifest.slug}-deployment-tests`;
const infrastructure = path.resolve(
  process.env.INFRASTRUCTURE_CHECKOUT || "../infrastructure",
);
const dispatcher = existsSync(
  path.join(infrastructure, "scripts/deploy-dispatch.py"),
);
console.log(
  dispatcher
    ? "Testing against the real Infrastructure dispatcher."
    : "Infrastructure checkout unavailable: cross-repository dispatcher integration not run.",
);

// Fixed, disposable Linux container. No VPS, host secrets or production services.
for (const args of [
  ["build", "-t", image, "tests/deploy"],
  [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${path.resolve(".")},target=/repo,readonly`,
    ...(dispatcher
      ? [
          "--mount",
          `type=bind,source=${infrastructure},target=/infrastructure,readonly`,
        ]
      : []),
    image,
  ],
]) {
  const result = spawnSync("docker", args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0) {
    if (result.error)
      console.error(
        `Docker unavailable: ${result.error.code}. Deployment container tests not run.`,
      );
    process.exitCode = result.status ?? 1;
    break;
  }
}
