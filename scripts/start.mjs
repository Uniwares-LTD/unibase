import { spawn } from "node:child_process";
import { prepareStandalone } from "./standalone.mjs";
import { loadLocalEnvironment } from "./environment.mjs";

// The generated server changes cwd to .next/standalone. Load the repository's
// production env files before spawning it, preserving normal npm start behavior.
loadLocalEnvironment(false);

const server = spawn(process.execPath, [prepareStandalone()], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME || "127.0.0.1" },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
server.on("error", () => {
  console.error("Standalone server failed to start.");
  process.exitCode = 1;
});
