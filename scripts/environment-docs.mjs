import { readFileSync, writeFileSync } from "node:fs";
const catalog = JSON.parse(
  readFileSync(
    new URL("./deploy/environment-catalog.json", import.meta.url),
    "utf8",
  ),
);
const output =
  "# Environment catalog\n\nGenerated from scripts/deploy/environment-catalog.json by node scripts/environment-docs.mjs.\n" +
  "Values and conditional requirements are described in .env.example and service guides.\n\n" +
  "| Scope | Accepted settings |\n| --- | --- |\n" +
  ["runtime", "localOnly", "tooling", "credentialPatterns"]
    .map(
      (scope) =>
        "| " +
        scope +
        " | " +
        catalog[scope].map((s) => "`" + s + "`").join(", ") +
        " |",
    )
    .join("\n") +
  "\n\nMCP permissions: " +
  catalog.mcpPermissions.map((s) => "`" + s + "`").join(", ") +
  ".\n";
const destination = new URL("../docs/environment-catalog.md", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(destination, "utf8") !== output)
    throw new Error("Environment documentation is stale.");
} else writeFileSync(destination, output);
