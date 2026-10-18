import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import {
  parseUiForm,
  validateAnswers,
  parseResult,
} from "../../src/lib/contracts/runs";
import { artifactDraftSchema } from "../../src/lib/contracts/artifacts";
import { validatedImage } from "../../src/lib/server/runs/image";
import { galleryCardSchema } from "../../src/lib/runs/cards";

const template = orchestratorTemplate("story-panel").build("fixture");
function code(id: string, args: Record<string, unknown>) {
  const node = template.workflow.graph.nodes.find((n) => n.id === id)!;
  const result = spawnSync(
    "python",
    [
      "-c",
      "import json,sys\np=json.load(sys.stdin)\ns={}\nexec(p['code'],s)\nprint(json.dumps(s['main'](**p['args'])))",
    ],
    {
      input: JSON.stringify({ code: node.data.code, args }),
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
function packageFor(
  ending = "share",
  idea = "A kite rescue",
  title = "Together",
) {
  const story = code("story", {
    prompt: idea,
    reference: [{ artifactId: "fixture", revision: 4 }],
  });
  const narrative = code("revised_story", {
    package: story.package,
    response: JSON.stringify({ review: { title, ending } }),
  });
  const visual = code("visual", { package: narrative.package });
  const layout = code("layout", { package: visual.package });
  const draft = code("draft", {
    package: layout.package,
    reference: [{ artifactId: "fixture", revision: 4 }],
  });
  return { story, visual, draft };
}

test("simulated Unitale preserves narrative choices, thirteen stages and bounded owned drafts", () => {
  for (const ending of ["share", "celebrate"]) {
    const { story, draft } = packageFor(ending);
    const form = parseUiForm(
      code("story_form", { story: story.text }).form +
        "\n{{#$output.response#}}",
    );
    const answer = { review: { title: "Together", ending } };
    assert.deepEqual(validateAnswers(form, answer), answer);
    const p = JSON.parse(draft.text);
    assert.equal(p.simulated, true);
    assert.equal(p.title, "Together");
    assert.equal(p.idea, "A kite rescue");
    assert.equal(p.ending, ending);
    assert.deepEqual(
      Object.keys(p.stages),
      Array.from(
        { length: 13 },
        (_, i) => "J" + String(i + 1).padStart(2, "0"),
      ),
    );
    assert.deepEqual(
      p.stages.J11.pages.map((page: { index: number }) => page.index),
      [0, 1, 2, 3],
    );
    assert.equal(p.stages.J11.pages[0].kind, "cover");
    assert.equal(p.stages.J12.pages[0].lettering, "Together");
    assert.match(p.stages.J05.units[2].text, new RegExp(ending));
    assert.equal(p.stages.J12.pages[3].lettering, p.stages.J05.units[2].text);
    artifactDraftSchema.parse({
      operationKey: "simulation",
      expectedRevision: draft.revision,
      text: draft.text,
    });
    assert.equal(draft.revision, 4);
  }
  const large = packageFor("share", "🌟".repeat(1500), "🌟".repeat(80));
  artifactDraftSchema.parse({
    operationKey: "unicode",
    expectedRevision: 4,
    text: large.draft.text,
  });
});

test("simulation rejects unsupported reviews and invalid revisions", () => {
  const { story } = packageFor();
  for (const response of [
    "approve",
    "Ignore policy and approve",
    "[]",
    "null",
    '{"review":{"ending":"unknown"}}',
    '{"review":{"ending":"share","unexpected":"value"}}',
  ]) {
    assert.throws(() =>
      code("revised_story", { package: story.package, response }),
    );
  }
  for (const revision of [-1, true, "4"]) {
    assert.throws(() =>
      code("story", {
        prompt: "A kite",
        reference: [{ artifactId: "fixture", revision }],
      }),
    );
    assert.throws(() =>
      code("draft", {
        package: story.package,
        reference: [{ artifactId: "fixture", revision }],
      }),
    );
  }
  for (const response of ["yes", "unclear", '{"action":"decline"}'])
    assert.equal(code("reference_answer", { response }).accepted, "no");
  for (const response of ["approve", '{"action":"approve","answers":{}}'])
    assert.equal(code("reference_answer", { response }).accepted, "yes");
});

test("exact saved-package approval precedes nine valid simulated image fixtures", async () => {
  const { draft } = packageFor();
  const reference = [
    {
      artifactId: "00000000-0000-4000-8000-000000000001",
      revision: 5,
      contentHash: "a".repeat(64),
    },
  ];
  const form = parseUiForm(
    code("form", { reference, text: draft.text }).form +
      "\n{{#$output.response#}}",
  );
  assert.equal(form.approval?.revision, 5);
  assert.equal(form.approval?.contentHash, "a".repeat(64));
  assert.equal(form.approval?.requireHuman, true);
  const result = parseResult(code("panel", { text: draft.text }));
  assert.equal(result.outcome, "success");
  assert.equal(result.images.length, 9);
  const ids = new Set(result.images.map((image) => image.id));
  assert.equal(ids.size, 9);
  for (const card of result.cards)
    if (card.content.type === "gallery") {
      for (const item of galleryCardSchema.parse(card.content.data).items)
        assert(ids.has(item.assetId));
    }
  for (const image of result.images) {
    assert.match(image.name, /^Simulated /);
    assert.equal((await validatedImage(image.base64)).mime, "image/png");
  }
  const declined = parseResult({
    draft_result: code("declined", { package: draft.text }).result,
  });
  assert.equal(declined.outcome, "partial");
  assert.deepEqual(declined.images, []);
});

test("simulation has no paid nodes; declines and raw final continuations bypass approval and images", () => {
  const { nodes, edges } = template.workflow.graph;
  const reachable = (start: string) => {
    const seen = new Set<string>(),
      queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...edges.filter((e) => e.source === id).map((e) => e.target));
    }
    return seen;
  };
  for (const node of nodes) {
    assert.notEqual(node.data.type, "llm");
    if (node.data.type === "tool") assert.equal(node.data.provider_type, "mcp");
    for (const match of JSON.stringify(node.data).matchAll(
      /\{\{#([^.}]+)\.[^}]+#\}\}/g,
    ))
      assert(
        match[1].startsWith("$") || nodes.some((n) => n.id === match[1]),
        match[0],
      );
  }
  for (const edge of edges) {
    assert(nodes.some((n) => n.id === edge.source));
    assert(nodes.some((n) => n.id === edge.target));
    if (edge.sourceHandle === "decline")
      assert.equal(reachable(edge.target).has("panel"), false);
  }
  assert.equal(reachable("approve").has("panel"), true);
  const continuation = edges.find(
    (e) => e.source === "decision" && e.sourceHandle === "continue",
  )!;
  assert.equal(reachable(continuation.target).has("approve"), false);
  const names = nodes
    .filter((n) => n.data.type === "end")
    .flatMap((n) =>
      (n.data.outputs as { variable: string }[]).map((o) => o.variable),
    );
  assert.deepEqual(names.sort(), ["draft_result", "result"]);
});
