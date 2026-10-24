import manifest from "../project.config.json" with { type: "json" };
import { spawn } from "node:child_process";
import { loadLocalEnvironment } from "./environment.mjs";
loadLocalEnvironment(true);
const projectId = process.env.FIREBASE_PROJECT_ID ?? `demo-${manifest.slug}`;
if (!/^demo-[a-z0-9-]+$/.test(projectId))
  throw new Error("The local Auth Emulator requires a demo project ID.");
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
    projectId,
  ],
  { stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
