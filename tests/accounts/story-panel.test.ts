import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import {
  parseUiForm,
  validateAnswers,
  parseResult,
  assertRawResponseForm,
} from "../../src/lib/contracts/runs";
import { artifactDraftSchema } from "../../src/lib/contracts/artifacts";
import { providerImages } from "../../src/lib/server/runs/provider-images";

const template = orchestratorTemplate("story-panel").build("fixture");
function node(id: string) {
  return template.workflow.graph.nodes.find((n) => n.id === id)!;
}
function code(id: string, args: Record<string, unknown>) {
  const result = spawnSync(
    "python",
    [
      "-c",
      "import json,sys\np=json.load(sys.stdin)\ns={}\nexec(p['code'],s)\nprint(json.dumps(s['main'](**p['args'])))",
    ],
    {
      input: JSON.stringify({ code: node(id).data.code, args }),
      encoding: "utf8",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}
const story = {
  title: "The Dangerous App",
  premise: "A child fixes an app that causes trouble.",
  outline: [
    "An app makes mistakes.",
    "The friends find the cause.",
    "They repair it together.",
  ],
  characters: [
    {
      name: "Ada",
      appearance: "Dark curls, purple hoodie, green sneakers.",
      role: "Young app maker",
    },
    {
      name: "Bo",
      appearance: "Freckles, yellow jacket, round glasses.",
      role: "Helpful friend",
    },
  ],
  location: {
    name: "Maker club",
    description: "Blue desks and a window facing the park.",
  },
  pages: [
    {
      narration: "Ada's new app sends everyone to the wrong room.",
      scene: "Ada looks surprised at her tablet.",
    },
    {
      narration: "Bo spots the swapped signs in the app.",
      scene: "The two friends compare their notes.",
    },
    {
      narration: "Together they fix the bug and help the club.",
      scene: "The club celebrates their repaired app.",
    },
  ],
};
const plan = {
  decision: "proceed",
  style: "Colorful inked comic, purple and gold palette.",
  characterSheets: [
    "Front, side and expressive portraits of Ada.",
    "Front, side and expressive portraits of Bo.",
  ],
  locationSheet: "Maker club desks and park window.",
  cover: "Ada and Bo hold a glowing tablet.",
  pages: story.pages.map((p) => ({ scene: p.scene, lettering: p.narration })),
};
function layout(overrides: Record<string, unknown> = {}) {
  return code("layout", {
    original: JSON.stringify(story),
    revised: JSON.stringify(story),
    plan: JSON.stringify(plan),
    idea: "A kid who made a dangerous app",
    ...overrides,
  });
}

test("real comic package retains generated cast, idea, thirteen stages and nine distinct prompts", () => {
  const result = layout();
  const p = JSON.parse(result.text);
  assert.equal(p.schemaVersion, "unitale-workflow-1");
  assert.equal(p.title, story.title);
  assert.deepEqual(p.stages.J06.characters, story.characters);
  assert.equal(p.stages.J01.idea, "A kid who made a dangerous app");
  assert.deepEqual(
    Object.keys(p.stages),
    Array.from({ length: 13 }, (_, i) => "J" + String(i + 1).padStart(2, "0")),
  );
  assert.equal(p.stages.J13.assetOrder.length, 9);
  assert.equal(
    new Set(Array.from({ length: 9 }, (_, i) => result["prompt" + (i + 1)]))
      .size,
    9,
  );
  assert.match(result.prompt6, /The Dangerous App/);
  assert.match(result.prompt9, /fix the bug/);
  assert.match(result.prompt3, /Ada/);
  assert.match(result.prompt4, /Bo/);
  const draft = code("draft", {
    text: result.text,
    reference: [{ artifactId: "fixture", revision: 4 }],
  });
  artifactDraftSchema.parse({
    operationKey: "comic",
    expectedRevision: draft.revision,
    text: draft.text,
  });
  assert.equal(draft.revision, 4);
  assert.equal(
    layout({ plan: JSON.stringify({ ...plan, decision: "stop" }) }).accepted,
    "no",
  );
});

test("User form answers and ordinary Persona prose reach model interpreters without strict review JSON", () => {
  const original = code("story_validate", { text: JSON.stringify(story) });
  const visual = code("visual_validate", { text: JSON.stringify(plan) });
  for (const [formId, decisionId, interpreterId, text] of [
    ["story_form", "story_decision", "revised_story", original.text],
    ["reference_form", "reference_decision", "reference_revision", visual.text],
  ]) {
    const ui = parseUiForm(
      code(formId, { text }).form + "\n{{#$output.response#}}",
    );
    assert.deepEqual(
      validateAnswers(ui, {
        feedback: "Give the app a friendly warning screen.",
      }),
      { feedback: "Give the app a friendly warning screen." },
    );
    assertRawResponseForm(
      node(decisionId).data as unknown as Parameters<
        typeof assertRawResponseForm
      >[0],
    );
    assert.equal(node(interpreterId).data.type, "llm");
    assert(
      JSON.stringify(node(interpreterId).data.prompt_template).includes(
        `{{#${decisionId}.response#}}`,
      ),
    );
    assert(code(formId, { text }).form.length < 4000);
  }
});

test("model output is bounded and validated before saving, including Unicode and malformed structures", () => {
  assert.deepEqual(
    JSON.parse(code("story_validate", { text: story }).package),
    story,
  );
  for (const id of ["story", "revised_story", "visual", "reference_revision"]) {
    assert.equal(node(id).data.structured_output_enabled, true);
    const structured = node(id).data.structured_output as {
      schema: { type: string; additionalProperties: boolean };
    };
    assert.equal(structured.schema.type, "object");
    assert.equal(structured.schema.additionalProperties, false);
  }
  const longerOutline = {
    ...story,
    outline: [...story.outline.slice(0, 2), "x".repeat(140)],
  };
  assert.equal(
    JSON.parse(
      code("story_validate", { text: JSON.stringify(longerOutline) }).package,
    ).outline[2].length,
    140,
  );
  assert.throws(() =>
    code("story_validate", {
      text: JSON.stringify({
        ...longerOutline,
        outline: ["x".repeat(201), "Middle", "End"],
      }),
    }),
  );
  assert.equal(
    JSON.parse(
      code("story_validate", {
        text: "```json\n" + JSON.stringify(story) + "\n```",
      }).package,
    ).title,
    story.title,
  );
  for (const value of [
    null,
    [],
    { ...story, characters: [] },
    { ...story, pages: story.pages.slice(1) },
    { ...story, title: "x".repeat(81) },
    { ...story, characters: [story.characters[0], story.characters[0]] },
    { ...story, secret: "unsupported" },
  ])
    assert.throws(() =>
      code("story_validate", { text: JSON.stringify(value) }),
    );
  assert.throws(() =>
    layout({ plan: JSON.stringify({ ...plan, decision: "uncertain" }) }),
  );
  assert.throws(() =>
    code("draft", {
      text: "x".repeat(8001),
      reference: [{ artifactId: "fixture", revision: 0 }],
    }),
  );
  assert.throws(() =>
    code("draft", {
      text: "draft",
      reference: [{ artifactId: "fixture", revision: true }],
    }),
  );
  artifactDraftSchema.parse({
    operationKey: "unicode",
    expectedRevision: 0,
    text: layout({ idea: "🌟".repeat(1500) }).text,
  });
});

test("real file outputs use existing native image contract and require all nine provider results", () => {
  const args: Record<string, unknown> = { text: layout().text };
  for (let i = 1; i <= 9; i++)
    args["files" + i] = [
      {
        type: "image",
        transfer_method: "tool_file",
        related_id: `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        url: `/files/tools/30000000-0000-4000-8000-${String(i).padStart(12, "0")}.png?timestamp=1&nonce=n&sign=s`,
      },
    ];
  const result = code("finish", args);
  assert.equal(parseResult({ result: result.result }).outcome, "success");
  assert.equal(
    providerImages({ result: result.result, unibase_images: result.images })
      .length,
    9,
  );
  assert.throws(() => code("finish", { ...args, files3: [] }));
  assert.throws(() =>
    code("finish", { ...args, files3: [{ type: "document" }] }),
  );
});

test("only exact human approval permits real image calls; declines keep partial text", () => {
  const draft = layout().text;
  const ui = parseUiForm(
    code("form", {
      text: draft,
      reference: [
        {
          artifactId: "00000000-0000-4000-8000-000000000001",
          revision: 3,
          contentHash: "a".repeat(64),
        },
      ],
    }).form + "\n{{#$output.response#}}",
  );
  assert.equal(ui.approval?.requireHuman, true);
  assert.equal(ui.approval?.revision, 3);
  assert.equal(ui.approval?.contentHash, "a".repeat(64));
  const partial = parseResult({
    draft_result: code("declined", { text: draft }).result,
  });
  assert.equal(partial.outcome, "partial");
  assert.deepEqual(partial.images, []);
  const reachable = (start: string) => {
    const seen = new Set<string>(),
      queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(
        ...template.workflow.graph.edges
          .filter((e) => e.source === id)
          .map((e) => e.target),
      );
    }
    return seen;
  };
  assert.equal(reachable("approve").has("image9"), true);
  for (const edge of template.workflow.graph.edges.filter(
    (e) =>
      e.sourceHandle === "decline" ||
      (e.source === "decision" && e.sourceHandle === "continue"),
  ))
    assert.equal(reachable(edge.target).has("image1"), false);
  const tools = template.workflow.graph.nodes.filter(
    (n) => n.data.type === "tool" && n.data.provider_type === "builtin",
  );
  assert.equal(tools.length, 9);
  for (const tool of tools)
    assert.equal(tool.data.tool_name, "gpt_image_generate");
});
