import { spawn } from "node:child_process";
import { loadLocalEnvironment } from "./environment.mjs";
loadLocalEnvironment(true);
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    windowsHide: true,
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", () => {
  console.error("Development server failed to start.");
  process.exitCode = 1;
});
