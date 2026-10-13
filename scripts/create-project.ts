import { readFile } from "node:fs/promises";
import { createProject } from "./project-initializer";
async function main() {
  const args = process.argv.slice(2),
    values: Record<string, string> = {};
  try {
    for (let i = 0; i < args.length; i += 2) {
      if (
        ![
          "--source",
          "--revision",
          "--destination",
          "--manifest",
          "--mode",
        ].includes(args[i]) ||
        !args[i + 1] ||
        values[args[i]]
      )
        throw new Error("Invalid initializer arguments.");
      values[args[i]] = args[i + 1];
    }
    if (
      !values["--manifest"] ||
      !values["--revision"] ||
      !values["--destination"] ||
      !values["--mode"]
    )
      throw new Error(
        "Required: --revision <full commit ID> --destination <new directory> --manifest <JSON file> --mode application|examples.",
      );
    const result = await createProject({
      source: values["--source"] ?? process.cwd(),
      revision: values["--revision"],
      destination: values["--destination"],
      manifest: JSON.parse(await readFile(values["--manifest"], "utf8")),
      mode: values["--mode"] as "application" | "examples",
    });
    console.log(
      `Created ${result.slug} from ${result.revision}. Install dependencies and review .env.example before starting.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Project initialization failed.",
    );
    process.exitCode = 1;
  }
}

void main();
