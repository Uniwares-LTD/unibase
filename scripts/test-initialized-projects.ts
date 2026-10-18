import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  copyFile,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createProject } from "./project-initializer";
import { project } from "../src/lib/project";

async function main() {
  const workspace = process.cwd();
  await mkdir(".cache/initialized-projects", { recursive: true });
  const root = await mkdtemp(
    path.resolve(".cache/initialized-projects/verification-"),
  );
  const source = path.join(root, "source");
  await mkdir(source);
  function command(
    cwd: string,
    command: string,
    args: string[],
    input?: string,
    env = process.env,
  ) {
    const result = spawnSync(command, args, {
      cwd,
      input,
      env,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.status !== 0)
      throw new Error(
        `${command} failed in ${path.basename(cwd)}:\n${result.stdout}\n${result.stderr}`,
      );
    return result.stdout;
  }
  // Build a private synthetic commit from the current reviewed working tree.
  // The user's repository, index and refs are never changed.
  const names = command(workspace, "git", [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ])
    .split("\0")
    .filter(Boolean);
  for (const name of new Set(names)) {
    if (/^(?:android\/project\/|\.env(?!\.example$)|\.git\/)/.test(name))
      continue;
    const target = path.join(source, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(workspace, name), target);
  }
  command(source, "git", ["init", "-q"]);
  command(source, "git", ["add", "."]);
  const tree = command(source, "git", ["write-tree"]).trim();
  const revision = command(
    source,
    "git",
    ["commit-tree", tree],
    "Isolated initializer acceptance source\n",
    {
      ...process.env,
      GIT_AUTHOR_NAME: "Initializer fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Initializer fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  ).trim();
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error("Run through npm run test:initialized-projects.");
  const rows = [];
  for (const slug of ["fixture-alpha", "fixture-beta"]) {
    const destination = path.join(root, slug);
    await createProject({
      source,
      revision,
      destination,
      manifest: { ...project, slug, displayName: slug, examples: false },
      mode: "application",
    });
    console.log(`Installing and building ${slug}.`);
    const env = {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      PAYMENTS_MODE: "disabled",
      DIFY_MODE: "disabled",
      PERSONA_COMPLETION_MODE: "disabled",
      MCP_ENABLED: "false",
      APP_ENV: "local",
      APP_NAME: slug,
    };
    for (const key of Object.keys(env))
      if (
        /^(?:MONGODB_|FIREBASE_|GOOGLE_|STRIPE_|MCP_|RUN_MCP_|DIFY_(?!MODE)|REDIS_|ANDROID_|NEXT_PUBLIC_)/.test(
          key,
        )
      )
        delete env[key as keyof typeof env];
    await writeFile(
      path.join(destination, "install-verification.log"),
      command(
        destination,
        process.execPath,
        [
          npm,
          "ci",
          "--ignore-scripts",
          ...(process.argv.includes("--offline") ? ["--offline"] : []),
          "--cache",
          path.join(workspace, ".cache/npm"),
        ],
        undefined,
        env,
      ),
    );
    await writeFile(
      path.join(destination, "build-verification.log"),
      command(
        destination,
        process.execPath,
        [npm, "run", "build"],
        undefined,
        env,
      ),
    );
    const namespaces = JSON.parse(
      command(
        destination,
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `const p=require('./src/lib/project.ts');console.log(JSON.stringify({cookie:p.namespace('session'),browser:p.namespace('theme'),cache:p.namespace('offline-v2'),database:p.databasePrefix,redis:p.namespace('limits'),deployment:'/opt/'+p.project.slug,examples:p.project.examples,artifacts:p.moduleEnabled('artifacts')}))`,
        ],
        undefined,
        env,
      ),
    );
    assert.equal(namespaces.examples, false);
    assert.equal(namespaces.artifacts, false);
    rows.push(namespaces);
    const sourceRecord = JSON.parse(
      await readFile(path.join(destination, "project.source.json"), "utf8"),
    );
    assert.equal(sourceRecord.revision, revision);
    if (process.argv.includes("--http")) {
      await writeFile(
        path.join(destination, "http-verification.log"),
        command(
          destination,
          process.execPath,
          ["scripts/integration.mjs", "--owned-auth"],
          undefined,
          env,
        ),
      );
      console.log(`${slug}: isolated account HTTP acceptance passed.`);
    }
  }
  for (const key of [
    "cookie",
    "browser",
    "cache",
    "database",
    "redis",
    "deployment",
  ])
    assert.notEqual(rows[0][key], rows[1][key], key);
  console.log(
    "Both initialized projects built independently with isolated namespaces. Fixture artifacts: " +
      root,
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Initializer verification failed.",
  );
  process.exitCode = 1;
});
