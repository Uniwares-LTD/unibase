// Lists, checks and removes the template's samples, as declared in samples.json.
// Usage: node scripts/samples.mjs list | check | remove <name> [--dry-run]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const registries = ["src/project/extensions.ts", "src/project/server.ts"];
const catalogFile = "scripts/deploy/environment-catalog.json";
const catalogs = ["messages/en.json", "messages/ar.json"];
const sourceRoots = ["src", "scripts", "tests"];

const read = (root, file) => readFileSync(path.join(root, file), "utf8");
const readJson = (root, file) => JSON.parse(read(root, file));
const marker = (name) => new RegExp(`//\\s*sample:${name}\\s*$`);
// A marked line must be a whole statement or array entry so deleting it keeps
// the registry valid.
const completeMarker = (line) => {
  const code = line.slice(0, line.lastIndexOf("//")).trim();
  const depth = (pattern) => (code.match(pattern) ?? []).length;
  return (
    depth(/[{([]/g) === depth(/[})\]]/g) &&
    ((code.startsWith("import ") && code.endsWith(";")) || code.endsWith(","))
  );
};
const inside = (file, paths) =>
  paths.some((owned) => file === owned || file.startsWith(owned + "/"));

export function loadSamples(root = ".") {
  return readJson(root, "samples.json").samples;
}

function sourceFiles(root) {
  const result = spawnSync(
    "git",
    ["-C", root, "ls-files", "-co", "--exclude-standard", ...sourceRoots],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("Could not list source files.");
  return result.stdout
    .split("\n")
    .filter(
      (file) =>
        /\.(?:[cm]?[jt]sx?)$/.test(file) && existsSync(path.join(root, file)),
    );
}

// Resolves "@/x" and relative specifiers to repository paths without extensions.
function importTargets(file, content) {
  return [
    ...content.matchAll(
      /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g,
    ),
  ].flatMap(([, specifier]) => {
    if (specifier.startsWith("@/")) return ["src/" + specifier.slice(2)];
    if (specifier.startsWith("."))
      return [path.posix.join(path.posix.dirname(file), specifier)];
    return [];
  });
}

// Structural removability: every declared path, registry marker and message
// exists, and nothing outside the sample depends on it except marked lines.
export function checkSamples(root = ".") {
  const samples = loadSamples(root),
    failures = [],
    files = sourceFiles(root),
    english = readJson(root, catalogs[0]).ui;
  for (const [name, sample] of Object.entries(samples)) {
    for (const dependency of sample.requires)
      if (!samples[dependency])
        failures.push(`${name} requires unknown sample ${dependency}.`);
    for (const owned of sample.paths)
      if (!existsSync(path.join(root, owned)))
        failures.push(`${name} lists missing path ${owned}.`);
    if (
      !registries.some((file) =>
        read(root, file)
          .split("\n")
          .some((line) => marker(name).test(line)),
      )
    )
      failures.push(`${name} has no sample:${name} registry line.`);
    for (const file of registries)
      for (const line of read(root, file).split("\n"))
        if (marker(name).test(line) && !completeMarker(line))
          failures.push(`${file} has a multi-line sample:${name} statement.`);
    for (const key of sample.messages)
      if (english[key] === undefined)
        failures.push(`${name} lists unknown message ${key}.`);
    const allowed = [
      ...sample.paths,
      ...Object.values(samples)
        .filter((value) => value.requires.includes(name))
        .flatMap((value) => value.paths),
    ];
    for (const file of files) {
      if (inside(file, allowed)) continue;
      const content = read(root, file);
      const lines = content.split("\n");
      for (const line of lines) {
        if (marker(name).test(line)) continue;
        for (const target of importTargets(file, line))
          if (
            sample.paths.some(
              (owned) =>
                inside(target, [owned]) || owned.startsWith(target + "."),
            )
          )
            failures.push(
              `${file} imports ${name} sample code outside a sample:${name} line.`,
            );
      }
      if (registries.includes(file) || file === "scripts/samples.mjs") continue;
      for (const key of sample.messages)
        if (content.includes(`"${key}"`))
          failures.push(`${file} uses ${name} message ${key}.`);
    }
  }
  return failures;
}

const prettier = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url),
);
async function format(root, files) {
  const result = spawnSync(process.execPath, [prettier, "--write", ...files], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error("Prettier could not format the edited files.");
}

// Removes one sample's files, registry lines, module, messages and MCP
// permissions, and records the removal in project.source.json when present.
export async function removeSample(
  root,
  name,
  { dryRun = false, generate = true } = {},
) {
  const samples = loadSamples(root),
    sample = samples[name];
  if (!sample) throw new Error(`Unknown sample ${name}.`);
  const dependents = Object.entries(samples)
    .filter(([, value]) => value.requires.includes(name))
    .map(([other]) => other);
  if (dependents.length)
    throw new Error(`Remove ${dependents.join(", ")} before ${name}.`);
  const plan = [
    ...sample.paths
      .filter((owned) => existsSync(path.join(root, owned)))
      .map((owned) => `delete ${owned}`),
    ...registries.map((file) => `edit ${file}`),
    "edit project.config.json",
    ...catalogs.map((file) => `edit ${file}`),
    ...(sample.mcpPermissions.length ? [`edit ${catalogFile}`] : []),
    "edit samples.json",
  ];
  // Validate and compute every edit before deleting anything, so a malformed
  // file or registration stops the removal with the tree unchanged.
  const edits = new Map();
  for (const file of registries) {
    const lines = read(root, file).split("\n");
    for (const line of lines)
      if (marker(name).test(line) && !completeMarker(line))
        throw new Error(`${file} has a multi-line sample:${name} statement.`);
    edits.set(
      file,
      lines.filter((line) => !marker(name).test(line)).join("\n"),
    );
  }
  const manifest = readJson(root, "project.config.json");
  if (!Array.isArray(manifest.modules))
    throw new Error("project.config.json has no modules list.");
  manifest.modules = manifest.modules.filter(
    (id) => !sample.modules.includes(id),
  );
  edits.set("project.config.json", JSON.stringify(manifest));
  for (const file of catalogs) {
    const messages = readJson(root, file);
    if (!messages.ui) throw new Error(`${file} has no ui messages.`);
    for (const key of sample.messages) delete messages.ui[key];
    edits.set(file, JSON.stringify(messages, null, 2) + "\n");
  }
  const catalog = readJson(root, catalogFile);
  if (!Array.isArray(catalog.mcpPermissions))
    throw new Error(`${catalogFile} has no mcpPermissions list.`);
  catalog.mcpPermissions = catalog.mcpPermissions.filter(
    (permission) => !sample.mcpPermissions.includes(permission),
  );
  edits.set(catalogFile, JSON.stringify(catalog));
  const manifestFile = readJson(root, "samples.json");
  delete manifestFile.samples[name];
  edits.set("samples.json", JSON.stringify(manifestFile));
  if (existsSync(path.join(root, "project.source.json"))) {
    const source = readJson(root, "project.source.json");
    source.removedSamples = [
      ...new Set([...(source.removedSamples ?? []), name]),
    ].sort();
    edits.set("project.source.json", JSON.stringify(source));
  }
  if (dryRun) return plan;
  if (!existsSync(prettier))
    throw new Error("Install dependencies before removing a sample.");
  for (const owned of sample.paths)
    rmSync(path.join(root, owned), { recursive: true, force: true });
  for (const [file, content] of edits)
    writeFileSync(path.join(root, file), content);
  await format(
    root,
    [...edits.keys()].filter((file) => !catalogs.includes(file)),
  );
  if (generate)
    for (const script of [
      "scripts/i18n-client-sections.mjs",
      "scripts/i18n-assets.mjs",
      "scripts/environment-docs.mjs",
    ]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: "utf8",
      });
      if (result.status !== 0)
        throw new Error(`${script} failed after removal.`);
    }
  return plan;
}

async function main() {
  const [command, name] = process.argv.slice(2);
  try {
    if (command === "list")
      for (const [id, sample] of Object.entries(loadSamples()))
        console.log(`${id}: ${sample.description}`);
    else if (command === "check") {
      const failures = checkSamples();
      for (const failure of failures) console.error(failure);
      if (failures.length) process.exitCode = 1;
      else console.log("Every sample is declared and removable.");
    } else if (command === "remove" && name) {
      const dryRun = process.argv.includes("--dry-run");
      const failures = checkSamples().filter((failure) =>
        new RegExp(`(?:^|[\\s:])${name}(?:[\\s.]|$)`).test(failure),
      );
      if (failures.length) {
        for (const failure of failures) console.error(failure);
        throw new Error(`Fix the ${name} declaration before removing it.`);
      }
      for (const step of await removeSample(".", name, { dryRun }))
        console.log(`${dryRun ? "would " : ""}${step}`);
      if (!dryRun)
        console.log(
          "Removed. Run npm run typecheck, npm run build and the test suites, then review the diff.",
        );
    } else {
      console.error(
        "Usage: samples.mjs list | check | remove <name> [--dry-run]",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
