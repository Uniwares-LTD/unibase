import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createProject } from "../scripts/project-initializer";
import { project } from "../src/lib/project";

test("initializer copies the reviewed tree, isolates identity, excludes private state and rejects unsafe targets", async () => {
  await mkdir(".cache/initializer-tests", { recursive: true });
  const root = await mkdtemp(path.resolve(".cache/initializer-tests/fixture-")),
    source = path.join(root, "source");
  await mkdir(source);
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "unibase", private: true }),
    "package-lock.json": JSON.stringify({
      name: "unibase",
      packages: { "": { name: "unibase" } },
    }),
    "project.config.json": JSON.stringify(project),
    ".env.example":
      "APP_NAME=Base\nFIREBASE_PROJECT_ID=demo-unibase\nMONGODB_DATABASE=unibase_local\n# PAYMENTS_MODE=disabled\n",
    "deploy/config.example.json": JSON.stringify({
      staging: {},
      production: {},
    }),
    "scripts/i18n-assets.mjs": "// public generator",
    "public/offline.html": "namespace=unibase",
    "public/offline-locale.js": "unibase-offline-locale",
    "README.md": "reviewed source",
    "scripts/handbook.mjs":
      "throw new Error('initializer must not run handbook setup');",
    ".agents/skills/manage-issues/SKILL.md": "shared entrypoint fixture",
    "scripts/handbook-integration.mjs": "// offline integration tooling",
    "handbook.json": '{"version":1,"kind":"consumer"}',
    "CLAUDE.md": "@AGENTS.md\n",
    ".claude/skills/manage-issues/SKILL.md": "thin Claude reference",
    "docs/source-map.md": "project-owned navigation",
    ".cache/handbook/baseline.json": "PRIVATE_HANDBOOK_CACHE",
    ".github/workflows/deploy.yml":
      "name: Release Unibase\non: workflow_dispatch\n",
    ".env.local": "PRIVATE_SENTINEL",
    "nested/.env.production": "PRIVATE_SENTINEL",
    "secrets/provider.json": "PRIVATE_SENTINEL",
    "serviceAccount.json": "PRIVATE_SENTINEL",
    ".npmrc": "//registry/:_authToken=PRIVATE_SENTINEL",
    "android/project/app/build.gradle": "old identity",
    "output/browser.json": "PRIVATE_SENTINEL",
  };
  for (const environment of ["local", "staging", "production"]) {
    const config = JSON.parse(
      await readFile(`deploy/environments/${environment}.json`, "utf8"),
    );
    config.ssh.host = "source-host.example.test";
    config.shared.ownerRepository = "source/installation";
    config.atlas.projectId = "source-atlas-id";
    config.google.projectId = "source-firebase-id";
    files[`deploy/environments/${environment}.json`] = JSON.stringify(config);
  }
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await writeFile(path.join(source, name), content);
  }
  function git(args: string[], input?: string) {
    const result = spawnSync("git", ["-C", source, ...args], {
      encoding: "utf8",
      input,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Initializer fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Initializer fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  git(["init", "-q"]);
  git(["add", "-f", "."]);
  const tree = git(["write-tree"]),
    revision = git(["commit-tree", tree], "Isolated test source\n");
  await writeFile(path.join(source, "README.md"), "unreviewed working edit");
  const manifest = {
    ...project,
    slug: "fixture-alpha",
    displayName: "Alpha $&",
    examples: false,
  };
  const destination = path.join(root, "alpha");
  await createProject({
    source,
    revision,
    destination,
    manifest,
    mode: "application",
  });
  assert.equal(
    await readFile(path.join(destination, "README.md"), "utf8"),
    "reviewed source",
  );
  assert.equal(
    await readFile(path.join(destination, "scripts/handbook.mjs"), "utf8"),
    files["scripts/handbook.mjs"],
  );
  assert.equal(
    await readFile(
      path.join(destination, ".agents/skills/manage-issues/SKILL.md"),
      "utf8",
    ),
    "shared entrypoint fixture",
  );
  for (const name of [
    "scripts/handbook-integration.mjs",
    "handbook.json",
    "CLAUDE.md",
    ".claude/skills/manage-issues/SKILL.md",
    "docs/source-map.md",
  ])
    assert.equal(
      await readFile(path.join(destination, name), "utf8"),
      files[name],
    );
  await assert.rejects(
    readFile(path.join(destination, ".cache/handbook/baseline.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(readdir(path.join(root, "handbook")), {
    code: "ENOENT",
  });
  assert.match(
    await readFile(
      path.join(destination, ".github/workflows/deploy.yml"),
      "utf8",
    ),
    /name: "Release Alpha \$&"/,
  );
  const derivedStaging = JSON.parse(
    await readFile(
      path.join(destination, "deploy/environments/staging.json"),
      "utf8",
    ),
  );
  assert.equal(derivedStaging.ssh.host, null);
  assert.equal(derivedStaging.shared.ownerRepository, null);
  assert.equal(derivedStaging.atlas.projectId, null);
  assert.equal(derivedStaging.google.projectId, null);
  assert.equal(
    derivedStaging.runtime.MONGODB_DATABASE,
    "fixture_alpha_staging",
  );
  assert.equal(derivedStaging.atlas.mongoUser, "fixture_alpha_staging");
  const copied = await readdir(destination, { recursive: true });
  for (const name of [
    ".git",
    ".env.local",
    "secrets/provider.json",
    "serviceAccount.json",
    "output/browser.json",
    "android/project/app/build.gradle",
  ])
    assert.ok(!copied.includes(name.replaceAll("/", path.sep)), name);
  assert.ok(
    !(await readFile(path.join(destination, ".npmrc"), "utf8")).includes(
      "PRIVATE_SENTINEL",
    ),
  );
  const env = await readFile(path.join(destination, ".env.example"), "utf8");
  assert.match(env, /demo-fixture-alpha/);
  assert.match(env, /APP_NAME="Alpha \$&"/);
  assert.match(env, /fixture_alpha_local/);
  assert.match(env, /DIFY_MODE=disabled/);
  assert.match(env, /PAYMENTS_MODE=disabled/);
  assert.equal(
    JSON.parse(
      await readFile(path.join(destination, "package-lock.json"), "utf8"),
    ).packages[""].name,
    "fixture-alpha",
  );
  assert.equal(
    JSON.parse(
      await readFile(path.join(destination, "project.source.json"), "utf8"),
    ).revision,
    revision,
  );
  const second = path.join(root, "beta");
  await createProject({
    source,
    revision,
    destination: second,
    manifest: { ...manifest, slug: "fixture-beta", examples: true },
    mode: "examples",
    infrastructureProfile: {
      ssh: { host: "shared-host.example.test", user: "operator" },
      google: { stagingProjectId: "shared-staging-fixture" },
      atlas: { projectId: "a".repeat(24), clusterName: "shared" },
    },
  });
  const sharedStaging = JSON.parse(
    await readFile(
      path.join(second, "deploy/environments/staging.json"),
      "utf8",
    ),
  );
  const independentProduction = JSON.parse(
    await readFile(
      path.join(second, "deploy/environments/production.json"),
      "utf8",
    ),
  );
  assert.equal(sharedStaging.ssh.host, "shared-host.example.test");
  assert.equal(sharedStaging.google.projectId, "shared-staging-fixture");
  assert.equal(
    sharedStaging.runtime.FIREBASE_PROJECT_ID,
    "shared-staging-fixture",
  );
  assert.equal(independentProduction.google.projectId, null);
  const a = JSON.parse(
      await readFile(
        path.join(destination, "deploy/config.example.json"),
        "utf8",
      ),
    ),
    b = JSON.parse(
      await readFile(path.join(second, "deploy/config.example.json"), "utf8"),
    );
  assert.notEqual(a.staging.mongoDatabase, b.staging.mongoDatabase);
  assert.notEqual(a.staging.ingressSubnet, b.staging.ingressSubnet);
  assert.notEqual(a.staging.port, b.staging.port);
  assert.match(
    await readFile(path.join(second, ".env.example"), "utf8"),
    /DIFY_MODE=fake/,
  );
  await assert.rejects(
    createProject({
      source,
      revision,
      destination: path.join(root, "private-profile"),
      manifest,
      mode: "application",
      infrastructureProfile: { ssh: { privateKey: "private-canary" } },
    }),
    /public connections/,
  );
  for (const bad of [source, root, path.join(source, "nested"), destination])
    await assert.rejects(
      createProject({
        source,
        revision,
        destination: bad,
        manifest,
        mode: "application",
      }),
    );
  await assert.rejects(
    createProject({
      source,
      revision: "HEAD",
      destination: path.join(root, "head"),
      manifest,
      mode: "application",
    }),
  );
  await assert.rejects(
    createProject({
      source,
      revision,
      destination: path.join(root, "bad"),
      manifest: { ...manifest, slug: "../escape" },
      mode: "application",
    }),
  );
  await assert.rejects(
    createProject({
      source,
      revision,
      destination: path.join(root, "examples"),
      manifest,
      mode: "examples",
    }),
  );
  const linkObject = git(["hash-object", "-w", "--stdin"], "../outside");
  git([
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${linkObject},source-link`,
  ]);
  const linkedRevision = git(
    ["commit-tree", git(["write-tree"])],
    "Unsafe symlink fixture\n",
  );
  await assert.rejects(
    createProject({
      source,
      revision: linkedRevision,
      destination: path.join(root, "linked"),
      manifest,
      mode: "application",
    }),
    /symlinks/,
  );
  assert.equal(
    await readFile(path.join(destination, "README.md"), "utf8"),
    "reviewed source",
  );
});
