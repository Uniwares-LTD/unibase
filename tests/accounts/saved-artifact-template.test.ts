import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parseResult } from "../../src/lib/contracts/runs";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";

const graph =
  orchestratorTemplate("saved-artifact").build("fixture").workflow.graph;
function execute(id: string, text: string) {
  const node = graph.nodes.find((n) => n.id === id)!;
  const result = spawnSync(
    "python",
    [
      "-c",
      "import json,sys\np=json.load(sys.stdin)\ns={}\nexec(p['code'],s)\nprint(json.dumps(s['main'](p['text'])))",
    ],
    { input: JSON.stringify({ code: node.data.code, text }), encoding: "utf8" },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).result;
}
function reachable(start: string) {
  const seen = new Set<string>(),
    queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(
      ...graph.edges.filter((e) => e.source === id).map((e) => e.target),
    );
  }
  return seen;
}

test("saved artifact declines retain partial text without images or a success path", () => {
  const text = "A draft with Unicode: باغ روشن 🌻";
  const partial = parseResult({ draft_result: execute("declined", text) });
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.text, text);
  assert.deepEqual(partial.images, []);
  for (const [source, handle] of [
    ["decision", "decline"],
    ["approval_route", "false"],
  ]) {
    const branch = graph.edges.find(
      (e) => e.source === source && e.sourceHandle === handle,
    )!;
    assert.ok(branch);
    const destinations = reachable(branch.target);
    assert.ok(destinations.has("declined_end"));
    assert.equal(destinations.has("approve"), false);
    assert.equal(destinations.has("finish"), false);
    assert.equal(destinations.has("end"), false);
  }
  assert.deepEqual(
    graph.edges.filter((e) => e.target === "finish").map((e) => e.source),
    ["approve"],
  );
});

test("saved artifact success retains its image and all End output names remain unique", () => {
  const success = parseResult({ result: execute("finish", "Approved draft") });
  assert.equal(success.outcome, "success");
  assert.equal(success.images.length, 1);
  const names = graph.nodes
    .filter((n) => n.data.type === "end")
    .flatMap((n) =>
      (n.data.outputs as { variable: string }[]).map((o) => o.variable),
    );
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("draft_result"));
});
