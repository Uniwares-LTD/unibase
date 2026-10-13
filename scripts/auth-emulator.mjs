import manifest from "../project.config.json" with { type: "json" };
import { spawn } from "node:child_process";
if (!/^[a-z][a-z0-9-]{2,39}$/.test(manifest.slug))
  throw new Error("Invalid project identity");
const child = spawn(
  process.execPath,
  [
    "node_modules/firebase-tools/lib/bin/firebase.js",
    "emulators:start",
    "--only",
    "auth",
    "--project",
    `demo-${manifest.slug}`,
  ],
  { stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
