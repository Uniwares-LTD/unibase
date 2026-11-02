import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runHandbook,
  resolveHandbook,
  sharedSkills,
} from "../scripts/handbook.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "consumer-handbook-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, "consumer"),
    origin = path.join(home, "origin"),
    directory = path.join(home, "handbook");
  mkdirSync(root);
  mkdirSync(origin);
  mkdirSync(path.join(origin, "scripts"));
  mkdirSync(path.join(origin, "docs"));
  for (const file of ["work-policy.md", "project.md", "onboarding.md"])
    writeFileSync(path.join(origin, "docs", file), "Fixture guidance\n");
  // A deliberately small helper fixture isolates launcher delegation from refresh tests.
  writeFileSync(
    path.join(origin, "scripts/refresh-handbook.mjs"),
    `
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
export function diagnose(directory) {return {path:directory,revision:git(directory,'rev-parse','HEAD')};}
export function refresh(directory, options) {
  const state=diagnose(directory);
  writeFileSync(path.join(git(directory,'rev-parse','--absolute-git-dir'),'uniwares-handbook-baseline.json'),JSON.stringify({origin:options.origin,revision:state.revision,synchronizedAt:new Date().toISOString()}));
  return {...state,force:options.force};
}
`,
  );
  for (const name of sharedSkills) {
    for (const base of [root, origin]) {
      const folder = path.join(base, ".agents/skills", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test ${name}\n---\nRun handbook:check then read .agents/skills/${name}/SKILL.md\n`,
      );
    }
  }
  git(origin, "init");
  git(origin, "config", "user.name", "Fixture");
  git(origin, "config", "user.email", "fixture@example.invalid");
  git(origin, "add", ".");
  git(origin, "commit", "-m", "fixture");
  git(origin, "branch", "-M", "main");
  return { home, root, origin, directory };
}
test("path resolution supports explicit paths and environment override without machine configuration", () => {
  const root = path.resolve("consumer");
  assert.equal(
    resolveHandbook(root, undefined, {}),
    path.resolve(root, "../handbook"),
  );
  assert.equal(
    resolveHandbook(root, undefined, { UNIWARES_HANDBOOK_PATH: "../custom" }),
    path.resolve(root, "../custom"),
  );
  assert.equal(
    resolveHandbook(root, "../explicit", {
      UNIWARES_HANDBOOK_PATH: "../custom",
    }),
    path.resolve(root, "../explicit"),
  );
});
test("setup is repeatable; check delegates force; doctor is read-only and diagnoses entrypoints", async (t) => {
  const f = fixture(t);
  const first = await runHandbook("setup", f);
  assert.equal((await runHandbook("setup", f)).revision, first.revision);
  assert.equal((await runHandbook("check", { ...f, force: true })).force, true);
  const metadata = path.join(
    f.directory,
    ".git/uniwares-handbook-baseline.json",
  );
  const before = readFileSync(metadata, "utf8");
  assert.deepEqual((await runHandbook("doctor", f)).warnings, []);
  assert.equal(readFileSync(metadata, "utf8"), before);
  writeFileSync(
    path.join(f.root, ".agents/skills/work-on-task/SKILL.md"),
    "custom legacy skill",
  );
  assert(
    (await runHandbook("doctor", f)).warnings.some((w) =>
      w.includes("Incompatible local"),
    ),
  );
  assert.equal(git(f.directory, "status", "--porcelain"), "");
});
test("dirty helper is never executed; cached tracked helper remains usable", async (t) => {
  const f = fixture(t);
  await runHandbook("setup", f);
  writeFileSync(
    path.join(f.directory, "scripts/refresh-handbook.mjs"),
    "throw new Error('DIRTY CODE EXECUTED');",
  );
  assert((await runHandbook("check", f)).revision);
  assert.match(
    readFileSync(
      path.join(f.directory, "scripts/refresh-handbook.mjs"),
      "utf8",
    ),
    /DIRTY CODE/,
  );
});
test("missing checkout and wrong origin do not initialize or overwrite during check/doctor", async (t) => {
  const f = fixture(t);
  for (const command of ["check", "doctor", "resources"]) {
    await assert.rejects(runHandbook(command, f), (error) => {
      assert.equal(error.code, "HANDBOOK_SETUP_REQUIRED");
      assert.equal(error.path, f.directory);
      assert.equal(error.origin, f.origin);
      assert.match(error.message, /After approval/);
      assert(error.message.includes(f.directory));
      return true;
    });
  }
  assert(!existsSync(f.directory));
  await runHandbook("setup", f);
  git(
    f.directory,
    "remote",
    "set-url",
    "origin",
    "https://example.invalid/unrelated.git",
  );
  await assert.rejects(runHandbook("setup", f), /Unexpected handbook origin/);
  assert.equal(
    git(f.directory, "remote", "get-url", "origin"),
    "https://example.invalid/unrelated.git",
  );
});
test("unsupported ancient helpers require explicit bootstrap reconciliation", async (t) => {
  const f = fixture(t);
  writeFileSync(
    path.join(f.origin, "scripts/refresh-handbook.mjs"),
    "export function refresh() {}\n",
  );
  git(f.origin, "commit", "-am", "unsupported helper");
  await assert.rejects(
    runHandbook("setup", f),
    /Incompatible committed helper/,
  );
  assert(
    !existsSync(path.join(f.directory, ".git/uniwares-handbook-baseline.json")),
  );
});
