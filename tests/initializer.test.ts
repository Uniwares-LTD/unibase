import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createProject } from "../scripts/project-initializer";
import { project } from "../src/lib/project";

test("initializer copies the reviewed tree, isolates identity, excludes private state and rejects unsafe targets", async () => {
  // The initialization commit uses git's configured identity.
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "Initializer fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Initializer fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
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
    "template.json": '{"version":"2.4.1","changelog":"CHANGELOG.md"}',
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
    // Like the template, keep LF checkouts independent of core.autocrlf.
    ".gitattributes": "* text=auto eol=lf\n",
    "scripts/handbook.mjs":
      "throw new Error('initializer must not run handbook setup');",
    ".agents/skills/manage-issues/SKILL.md": "shared entrypoint fixture",
    ".agents/handbook.md": "# Portable bootstrap\nRun handbook:check.\n",
    "scripts/handbook-integration.mjs": "// offline integration tooling",
    "handbook.json":
      '{"version":1,"kind":"consumer","tracking":".agents/tracking.json","preferences":".agents/repository.md"}',
    ".agents/tracking.json": '{"organization":"source-org","number":2}',
    ".agents/repository.md": "Source-owned branch and language preferences",
    "CLAUDE.md": "@AGENTS.md\n",
    ".claude/skills/manage-issues/SKILL.md": "thin Claude reference",
    ".cache/handbook/baseline.json": "PRIVATE_HANDBOOK_CACHE",
    ".github/workflows/deploy.yml":
      "name: Release Unibase\non: workflow_dispatch\n",
    ".npmrc": "cache=.cache/npm\n",
    ".vscode/settings.json": "{}",
    "android/project/app/build.gradle": "old identity",
    "output/browser.json": "PRIVATE_SENTINEL",
  };
  // Use the actual reusable guidance so its links and ownership claims are covered.
  const guidanceFiles = [
    "AGENTS.md",
    ".agents/repository-adapter.md",
    "docs/source-map.md",
    "docs/agent-tooling.md",
  ];
  for (const name of guidanceFiles)
    files[name] = (await readFile(name, "utf8")).replaceAll("\r\n", "\n");
  for (const name of ["deploy/contract.json", "scripts/deploy/operations.py"])
    files[name] = (await readFile(name, "utf8")).replaceAll("\r\n", "\n");
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
  const retention = JSON.parse(
    await readFile(
      path.join(destination, "deploy/image-retention.proposal.json"),
      "utf8",
    ),
  );
  assert.equal(retention.project, manifest.slug);
  assert.equal(
    retention.imageRepository,
    `ghcr.io/replace-owner/${manifest.slug}`,
  );
  assert.equal(retention.automatic, false);
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
    ".agents/handbook.md",
    "CLAUDE.md",
    ".claude/skills/manage-issues/SKILL.md",
    "docs/source-map.md",
  ])
    assert.equal(
      await readFile(path.join(destination, name), "utf8"),
      files[name],
    );
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(destination, ".agents/tracking.json"), "utf8"),
    ),
    { version: 1, provider: "github", organization: null, repositories: [] },
  );
  const preferences = await readFile(
    path.join(destination, ".agents/repository.md"),
    "utf8",
  );
  assert.match(preferences, /Not configured/);
  assert.doesNotMatch(
    preferences,
    /Source-owned|Issue language:|Integration branch:/,
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(destination, "handbook.json"), "utf8")),
    JSON.parse(files["handbook.json"]),
  );
  for (const name of guidanceFiles) {
    const content = await readFile(path.join(destination, name), "utf8");
    // Historical verification is evidence, not a current tracking declaration.
    const current = content.split("## Integration reconciliation")[0];
    assert.doesNotMatch(current, /retains Uniwares project #2/);
    const links = [
      ...content.matchAll(/\]\(([^)]*(?:repository\.md|tracking\.json))\)/g),
    ];
    assert(
      links.length > 0,
      `${name} must exercise the inherited configuration links`,
    );
    for (const match of links) {
      await readFile(
        path.resolve(destination, path.dirname(name), match[1]),
        "utf8",
      );
    }
  }
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
    "output/browser.json",
    "android/project/app/build.gradle",
    ".vscode/settings.json",
  ])
    assert.ok(!copied.includes(name.replaceAll("/", path.sep)), name);
  // The derived repository shares the reviewed history: one initialization
  // commit on top of the source revision, and an upstream remote.
  const derived = (...args: string[]) => {
    const result = spawnSync("git", ["-C", destination, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  assert.equal(derived("rev-parse", "HEAD^"), revision);
  assert.equal(
    derived("log", "-1", "--format=%s"),
    "Initialize fixture-alpha from template 2.4.1",
  );
  assert.equal(derived("status", "--porcelain"), "");
  assert.equal(derived("remote", "get-url", "upstream"), source);
  assert.equal(derived("branch", "--show-current"), "main");
  // Excluded generated files are deleted in the initialization commit.
  assert.ok(
    derived("show", "--name-status", "--format=", "HEAD")
      .split("\n")
      .includes("D\tandroid/project/app/build.gradle"),
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
  const sourceRecord = JSON.parse(
    await readFile(path.join(destination, "project.source.json"), "utf8"),
  );
  assert.equal(sourceRecord.revision, revision);
  assert.equal(sourceRecord.templateVersion, "2.4.1");
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
  // Private material anywhere in the reviewed history is refused, even when a
  // later commit deleted it, because derived projects inherit the history.
  for (const [name, content] of [
    [".env.local", "PRIVATE_SENTINEL"],
    ["secrets/provider.json", "{}"],
    ["serviceAccount.json", "{}"],
    [".npmrc", "//registry/:_authToken=PRIVATE_SENTINEL"],
  ]) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await writeFile(path.join(source, name), content);
    git(["add", "-f", name]);
    const leaked = git(
      ["commit-tree", git(["write-tree"]), "-p", revision],
      "Private test source\n",
    );
    git(["rm", "-q", "--cached", name]);
    if (name === ".npmrc") {
      await writeFile(path.join(source, name), "cache=.cache/npm\n");
      git(["add", "-f", name]);
    }
    const cleaned = git(
      ["commit-tree", git(["write-tree"]), "-p", leaked],
      "Cleaned test source\n",
    );
    await assert.rejects(
      createProject({
        source,
        revision: cleaned,
        destination: path.join(root, "leaked"),
        manifest,
        mode: "application",
      }),
      /private material/,
    );
  }

  // Revisions before template versioning, or with an invalid version, are refused.
  for (const [content, message] of [
    [null, /predates template versioning/],
    ['{"version":"01.0.0"}', /no valid template version/],
  ] as const) {
    if (content === null) git(["rm", "-q", "--cached", "template.json"]);
    else {
      await writeFile(path.join(source, "template.json"), content);
      git(["add", "-f", "template.json"]);
    }
    const unversioned = git(
      ["commit-tree", git(["write-tree"])],
      "Unversioned test source\n",
    );
    await assert.rejects(
      createProject({
        source,
        revision: unversioned,
        destination: path.join(root, "unversioned"),
        manifest,
        mode: "application",
      }),
      message,
    );
  }
  for (const upstream of [
    "https://user:token@github.com/org/template.git",
    "https://token@github.com/org/template.git",
    "ssh://git:secret@github.com/org/template.git",
  ])
    await assert.rejects(
      createProject({
        source,
        revision,
        destination: path.join(root, "credentials"),
        manifest,
        mode: "application",
        upstream,
      }),
      /must not contain credentials/,
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
