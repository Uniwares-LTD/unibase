import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const kind = process.argv[2];
const scripts = readdirSync("scripts/deploy")
  .filter((name) => name.endsWith(".sh"))
  .map((name) => `scripts/deploy/${name}`);
const commands =
  kind === "shell"
    ? [
        ...scripts.map((file) => [
          process.platform === "win32"
            ? "C:/Program Files/Git/bin/bash.exe"
            : "bash",
          ["-n", file],
        ]),
        ["shellcheck", ["-x", ...scripts]],
      ]
    : [
        [
          process.platform === "win32"
            ? ".cache/actionlint/actionlint.exe"
            : "actionlint",
          ["-color"],
        ],
      ];
let failed = false;
for (const [command, args] of commands) {
  let result = spawnSync(command, args, { stdio: "inherit" });
  if (command === "shellcheck" && result.error) {
    console.log(
      "Native ShellCheck unavailable; trying the owned deployment-test container.",
    );
    result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--mount",
        `type=bind,source=${path.resolve(".")},target=/repo,readonly`,
        "--entrypoint",
        "shellcheck",
        "unitale-deployment-tests",
        "-x",
        ...scripts,
      ],
      { stdio: "inherit", windowsHide: true },
    );
  }
  if (result.error)
    console.error(`${command} unavailable; check not performed.`);
  failed ||= result.status !== 0;
}
process.exitCode = failed ? 1 : 0;
