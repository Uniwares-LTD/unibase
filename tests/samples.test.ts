import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSamples, removeSample } from "../scripts/samples.mjs";

test("every declared sample is removable from this repository", () => {
  assert.deepEqual(checkSamples("."), []);
});

// A synthetic fixture keeps this test valid after a project removes samples.
test("removing a sample deletes its paths and every registration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "samples-"));
  const write = async (file: string, value: unknown) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(
      path.join(root, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const sample = (requires: string[], paths: string[]) => ({
    description: "x",
    requires,
    paths,
    modules: [paths[0].split("/").pop()],
    messages: [`m${paths[0].length.toString().padStart(12, "0")}`],
    mcpPermissions: [`${paths[0].split("/").pop()}:read`],
  });
  try {
    await write("samples.json", {
      version: 1,
      samples: {
        demo: sample([], ["src/samples/demo", "src/app/demo"]),
        child: sample(["demo"], ["src/samples/child-x"]),
      },
    });
    await write("project.config.json", {
      modules: ["files", "demo", "child-x"],
    });
    for (const file of ["messages/en.json", "messages/ar.json"])
      await write(file, {
        ui: { m000000000016: "demo", m000000000019: "child", keep: "kept" },
      });
    await write("scripts/deploy/environment-catalog.json", {
      mcpPermissions: ["server:read", "demo:read", "child-x:read"],
    });
    await write(
      "src/project/extensions.ts",
      'import { demo } from "../samples/demo"; // sample:demo\nimport { child } from "../samples/child-x"; // sample:child\nexport const extensions = [\n  demo, // sample:demo\n  child, // sample:child\n];\n',
    );
    await write(
      "src/project/server.ts",
      "export const serverExtensions = [];\n",
    );
    await write("src/samples/demo/index.ts", "");
    await write("src/app/demo/page.tsx", "");
    await write("src/samples/child-x/index.ts", "");
    await write("project.source.json", { version: 1, revision: "r" });
    const json = async (file: string) =>
      JSON.parse(await readFile(path.join(root, file), "utf8"));

    await assert.rejects(
      removeSample(root, "demo"),
      /Remove child before demo/,
    );
    assert.ok(
      (await removeSample(root, "child", { dryRun: true })).includes(
        "delete src/samples/child-x",
      ),
    );
    assert.ok(existsSync(path.join(root, "src/samples/child-x")));

    await removeSample(root, "child", { generate: false });
    await removeSample(root, "demo", { generate: false });
    for (const owned of [
      "src/samples/demo",
      "src/app/demo",
      "src/samples/child-x",
    ])
      assert.equal(existsSync(path.join(root, owned)), false);
    assert.doesNotMatch(
      await readFile(path.join(root, "src/project/extensions.ts"), "utf8"),
      /demo|child/,
    );
    assert.deepEqual((await json("project.config.json")).modules, ["files"]);
    for (const file of ["messages/en.json", "messages/ar.json"])
      assert.deepEqual((await json(file)).ui, { keep: "kept" });
    assert.deepEqual(
      (await json("scripts/deploy/environment-catalog.json")).mcpPermissions,
      ["server:read"],
    );
    assert.deepEqual((await json("samples.json")).samples, {});
    assert.deepEqual((await json("project.source.json")).removedSamples, [
      "child",
      "demo",
    ]);
    await assert.rejects(removeSample(root, "demo"), /Unknown sample/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removal preflight leaves the tree unchanged and check finds side-effect imports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "samples-preflight-"));
  const write = async (file: string, content: string) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  };
  try {
    await write(
      "samples.json",
      JSON.stringify({
        version: 1,
        samples: {
          demo: {
            description: "x",
            requires: [],
            paths: ["src/samples/demo"],
            modules: [],
            messages: [],
            mcpPermissions: [],
          },
        },
      }),
    );
    await write("project.config.json", '{"modules":[]}');
    for (const file of ["messages/en.json", "messages/ar.json"])
      await write(file, '{"ui":{}}');
    await write(
      "scripts/deploy/environment-catalog.json",
      '{"mcpPermissions":[]}',
    );
    await write("src/samples/demo/index.ts", "");
    await write(
      "src/project/server.ts",
      "export const serverExtensions = [];\n",
    );
    // A marker on a statement that continues on the next line is unsafe to drop.
    await write(
      "src/project/extensions.ts",
      'import {\n  demo } from "../samples/demo"; // sample:demo\nexport const extensions = [demo];\n',
    );
    await write("src/lib/uses-demo.ts", 'import "@/samples/demo/index";\n');
    const git = (...args: string[]) =>
      spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q");
    await assert.rejects(removeSample(root, "demo"), /multi-line sample:demo/);
    assert.ok(existsSync(path.join(root, "src/samples/demo/index.ts")));
    const failures = checkSamples(root);
    assert.ok(
      failures.some((failure) =>
        failure.startsWith("src/lib/uses-demo.ts imports demo"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
