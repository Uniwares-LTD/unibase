import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import runtimeSettings from "./runtime-settings.cjs";

export async function writeRuntimeSettings(root = process.cwd()) {
  const result = {};
  for (const environment of ["local", "staging", "production"]) {
    const config = JSON.parse(
      await readFile(
        path.join(root, "deploy/environments", environment + ".json"),
        "utf8",
      ),
    );
    if (
      config.environment !== environment ||
      config.runtime.APP_ENV !== environment
    )
      throw new Error("Application runtime environment mismatch.");
    result[environment] = {
      DIAGNOSTICS_ENABLED: config.runtime.DIAGNOSTICS_ENABLED,
    };
  }
  runtimeSettings.selectRuntimeSettings(result, "local");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(
    path.join(root, "dist/runtime-settings.json"),
    JSON.stringify(result) + "\n",
  );
}
