import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const handbookOrigin = "https://github.com/Uniwares-LTD/handbook.git";
export const sharedSkills = [
  "capture-project-learnings",
  "compile-feature-spec",
  "manage-issues",
  "review-change",
  "sync-docs-issues",
  "work-on-task",
];
const normalize = (value) =>
  value
    .replace(/^git@github.com:/, "https://github.com/")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30000,
  }).trim();
export function resolveHandbook(root, explicit, environment = process.env) {
  return path.resolve(
    root,
    explicit || environment.UNIWARES_HANDBOOK_PATH || "../handbook",
  );
}
export async function runHandbook(
  command,
  { root, directory, force = false, origin = handbookOrigin } = {},
) {
  root = path.resolve(
    root || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  directory = resolveHandbook(root, directory);
  if (!["setup", "check", "doctor"].includes(command))
    throw new Error("Use setup, check or doctor.");
  if (!existsSync(directory)) {
    if (command !== "setup")
      throw new Error(
        "Handbook is not installed. Run npm run handbook:setup. Continue under local guidance; pause only handbook-dependent decisions.",
      );
    mkdirSync(path.dirname(directory), { recursive: true });
    git(
      path.dirname(directory),
      "clone",
      "--branch",
      "main",
      "--single-branch",
      origin,
      directory,
    );
  }
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw new Error("Handbook path must be an ordinary checkout directory.");
  if (
    normalize(git(directory, "remote", "get-url", "origin")) !==
    normalize(origin)
  )
    throw new Error("Unexpected handbook origin; directory left untouched.");
  const metadata = git(directory, "rev-parse", "--absolute-git-dir");
  const baselineFile = path.join(metadata, "uniwares-handbook-baseline.json");
  const baseline = existsSync(baselineFile)
    ? JSON.parse(readFileSync(baselineFile, "utf8"))
    : null;
  if (
    baseline &&
    (normalize(baseline.origin) !== normalize(origin) ||
      !/^[a-f0-9]{40,64}$/.test(baseline.revision))
  )
    throw new Error("Invalid handbook baseline.");
  const dirty = Boolean(
    git(directory, "status", "--porcelain", "--untracked-files=all"),
  );
  const branch = git(directory, "branch", "--show-current");
  if (!baseline && (dirty || branch !== "main")) {
    if (command === "doctor")
      return {
        path: directory,
        branch,
        dirty,
        revision: null,
        warnings: [
          "No synchronized baseline; preserve local work and run setup from a clean main checkout.",
        ],
      };
    throw new Error(
      "No synchronized baseline and checkout is dirty or not on main. Preserve local work; pause only handbook-dependent decisions.",
    );
  }
  // Execute the tracked helper at the accepted baseline, never a dirty working copy.
  const revision = baseline?.revision || git(directory, "rev-parse", "HEAD");
  let source = git(
    directory,
    "show",
    `${revision}:scripts/refresh-handbook.mjs`,
  );
  if (!source.includes("export function diagnose(")) {
    if (command === "doctor")
      return {
        path: directory,
        branch,
        dirty,
        revision: baseline?.revision ?? null,
        warnings: ["Legacy helper: run setup from clean main to update."],
      };
    // Original bootstrap helper predates data-URL imports. Omit only its CLI entrypoint.
    const boundary = source.indexOf("\nif (process.argv[1]");
    if (boundary < 0)
      throw new Error(
        "Unrecognized legacy helper; inspect setup before updating.",
      );
    const legacy = await import(
      `data:text/javascript;base64,${Buffer.from(source.slice(0, boundary)).toString("base64")}`
    );
    const upgraded = legacy.refresh(directory, { origin });
    source = git(
      directory,
      "show",
      `${upgraded.revision}:scripts/refresh-handbook.mjs`,
    );
    if (!source.includes("export function diagnose("))
      return {
        ...upgraded,
        mode: "cached",
        limitation:
          upgraded.limitation ||
          "Legacy helper retained; update from clean main when available.",
      };
  }
  const helper = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  if (typeof helper.diagnose !== "function")
    throw new Error(
      "Handbook helper is older than this launcher. Update the clean handbook main checkout, then retry.",
    );
  const state =
    command === "doctor"
      ? helper.diagnose(directory, { origin })
      : helper.refresh(directory, { origin, force });
  if (command !== "doctor") return state;
  const warnings = [];
  const selected = state.revision;
  for (const name of sharedSkills) {
    const local = path.join(root, ".agents", "skills", name, "SKILL.md");
    if (!existsSync(local)) {
      warnings.push(`Missing local entrypoint: ${name}`);
      continue;
    }
    const text = readFileSync(local, "utf8");
    if (
      !text.includes("handbook:check") ||
      !text.includes(`.agents/skills/${name}/SKILL.md`)
    )
      warnings.push(`Incompatible local entrypoint: ${name}`);
    if (!selected) continue;
    try {
      const upstream = git(
        directory,
        "show",
        `${selected}:.agents/skills/${name}/SKILL.md`,
      );
      const description = (content) =>
        content.match(/^description: (.+)$/m)?.[1]?.trim();
      if (!upstream.includes(`name: ${name}`))
        warnings.push(`Upstream skill identity changed: ${name}`);
      if (description(text) !== description(upstream))
        warnings.push(
          `Description differs for ${name}; review when updating entrypoints (not a blocker).`,
        );
    } catch {
      warnings.push(`Shared skill unavailable at cached revision: ${name}`);
    }
  }
  return { ...state, warnings };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let directory,
      force = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--path" && args[i + 1]) directory = args[++i];
      else if (args[i] === "--force" && command === "check") force = true;
      else
        throw new Error(
          "Usage: node scripts/handbook.mjs setup|check|doctor [--path directory] [--force (check only)]",
        );
    }
    console.log(
      JSON.stringify(await runHandbook(command, { directory, force }), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
