import { cpSync, existsSync } from "node:fs";
import path from "node:path";

export function prepareStandalone() {
  const root = path.resolve(".next/standalone");
  const server = path.join(root, "server.js");
  if (!existsSync(server))
    throw new Error("Run npm run build before starting the standalone server.");
  cpSync("public", path.join(root, "public"), { recursive: true });
  cpSync(".next/static", path.join(root, ".next/static"), { recursive: true });
  return server;
}
