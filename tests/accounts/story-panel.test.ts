import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import {
  parseUiForm,
  validateAnswers,
  parseResult,
} from "../../src/lib/contracts/runs";
import { responderAnswer } from "../../src/lib/server/runs/responder";

const template = orchestratorTemplate("story-panel").build("fixture");
function code(id: string, args: Record<string, unknown>, workflow = template) {
  const node = workflow.workflow.graph.nodes.find((n) => n.id === id)!;
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

test("story review offers approval and changes together, with persona-compatible character approval", () => {
  const story = "A curious child finds a tiny moon in a garden.";
  const form = parseUiForm(
    code("story_form", { story }).form + "\n{{#$output.response#}}",
  );
  const answers = {
    review: {
      decision: "changes",
      changes: "Make the explorer a friendly robot.",
    },
  };
  assert.deepEqual(validateAnswers(form, answers), answers);
  const approved = { review: { decision: "approved" } };
  assert.deepEqual(validateAnswers(form, approved), approved);
  assert.throws(() => validateAnswers(form, { review: {} }));
  assert.throws(() =>
    validateAnswers(form, { review: { decision: "unknown" } }),
  );
  assert.throws(() =>
    validateAnswers(form, {
      review: { decision: "changes", changes: "x".repeat(4001) },
    }),
  );
  assert.throws(() => code("story_form", { story: "x".repeat(1201) }));
  const parsed = responderAnswer(
    {
      inputs: {
        question: JSON.stringify({
          form_content:
            code("story_form", { story }).form + "\n{{#$output.response#}}",
          inputs: [],
          user_actions: [{ id: "continue", title: "Continue" }],
          resolved_default_values: {},
        }),
      },
    },
    { answer: JSON.stringify({ action: "continue", answers }) },
  );
  assert.deepEqual(parsed, { action: "continue", answers });
  assert.deepEqual(
    responderAnswer(
      {
        inputs: {
          question: JSON.stringify({
            form_content:
              code("story_form", { story }).form + "\n{{#$output.response#}}",
            inputs: [],
            user_actions: [{ id: "continue", title: "Continue" }],
            resolved_default_values: {},
          }),
        },
      },
      { answer: { action: "continue", answers: approved } },
    ),
    { action: "continue", answers: approved },
  );
  const draft = code("draft", {
    story: "A friendly robot finds a tiny moon.",
    character: "Lumi is a small silver robot with a blue scarf.",
    reference: [{ artifactId: "fixture-artifact", revision: 4 }],
  });
  assert.match(draft.prompt, /friendly robot/);
  assert.match(draft.prompt, /blue scarf/);
  assert.equal(draft.revision, 4);
  const reference = [
    {
      artifactId: "00000000-0000-4000-8000-000000000001",
      revision: 5,
      contentHash: "a".repeat(64),
    },
  ];
  const approval = parseUiForm(
    code("form", { reference, text: draft.text }).form +
      "\n{{#$output.response#}}",
  );
  assert.equal(approval.approval?.revision, 5);
  assert.equal(approval.approval?.requireHuman, false);
  const approve = responderAnswer(
    {
      inputs: {
        question: JSON.stringify({
          form_content:
            code("form", { reference, text: draft.text }).form +
            "\n{{#$output.response#}}",
          inputs: [],
          user_actions: [
            { id: "approve", title: "Approve and generate panel" },
            { id: "decline", title: "Decline character" },
          ],
          resolved_default_values: {},
        }),
      },
    },
    { answer: JSON.stringify({ action: "approve", answers: {} }) },
  );
  assert.deepEqual(approve, { action: "approve", answers: { draft: null } });
  assert.equal(
    parseResult(code("declined", { text: draft.text })).outcome,
    "partial",
  );
  assert.deepEqual(
    parseResult(code("declined", { text: draft.text })).images,
    [],
  );
});

test("responder normalizes plain prose only for one unambiguous text question", () => {
  const responder = orchestratorTemplate("persona-responder").build("fixture");
  // The story template now uses a form. Retain coverage of the responder's
  // generic single-text normalization with a standalone question fixture.
  const storyForm =
    "```unibase-ui\n" +
    JSON.stringify({
      version: 1,
      cards: [
        {
          id: "changes",
          content: {
            type: "question",
            version: 1,
            data: {
              kind: "text",
              title: "Requested changes",
              explanation: "A robot finds a firefly.",
              options: [],
            },
          },
        },
      ],
    }) +
    "\n```";
  const question = JSON.stringify({ form_content: storyForm });
  const answer = { action: "revise", answers: "Give the robot a blue scarf." };
  assert.deepEqual(
    JSON.parse(code("compose", { answer, question }, responder).answer),
    { action: "revise", answers: { changes: answer.answers } },
  );
  const objectAnswer = {
    action: "revise",
    answers: JSON.stringify({ changes: "Keep it as is." }),
  };
  assert.deepEqual(
    JSON.parse(
      code("compose", { answer: objectAnswer, question }, responder).answer,
    ).answers,
    { changes: "Keep it as is." },
  );
  const other = (cards: unknown[]) =>
    JSON.stringify({
      form_content:
        "```unibase-ui\n" + JSON.stringify({ version: 1, cards }) + "\n```",
    });
  const textCard = {
    id: "first",
    content: { type: "question", version: 1, data: { kind: "text" } },
  };
  for (const cards of [
    [],
    [textCard, { ...textCard, id: "second" }],
    [{ id: "approval", content: { type: "summary", version: 1, data: {} } }],
    [
      {
        id: "choice",
        content: { type: "question", version: 1, data: { kind: "single" } },
      },
    ],
  ])
    assert.throws(() =>
      code("compose", { answer, question: other(cards) }, responder),
    );
  const summary = {
    id: "draft",
    content: {
      type: "summary",
      version: 1,
      data: { title: "Review", body: "Character" },
    },
  };
  const nullAnswer = { action: "approve", answers: "null" };
  assert.deepEqual(
    JSON.parse(
      code(
        "compose",
        { answer: nullAnswer, question: other([summary]) },
        responder,
      ).answer,
    ),
    { action: "approve", answers: { draft: null } },
  );
  for (const invalid of ["true", '"approved"'])
    assert.throws(() =>
      code(
        "compose",
        {
          answer: { action: "approve", answers: invalid },
          question: other([summary]),
        },
        responder,
      ),
    );
  assert.throws(() =>
    code("compose", { answer: nullAnswer, question }, responder),
  );
});

test("only the approved branch reaches real panel generation", () => {
  const edges = template.workflow.graph.edges;
  function reachable(start: string) {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...edges.filter((e) => e.source === id).map((e) => e.target));
    }
    return seen;
  }
  assert.equal(
    reachable(
      edges.find(
        (e) => e.source === "decision" && e.sourceHandle === "decline",
      )!.target,
    ).has("panel"),
    false,
  );
  assert.equal(
    reachable(
      edges.find(
        (e) => e.source === "decision" && e.sourceHandle === "approve",
      )!.target,
    ).has("panel"),
    true,
  );
  const end = template.workflow.graph.nodes.find((n) => n.id === "end")!;
  assert.deepEqual(
    (end.data.outputs as { variable: string; value_selector: string[] }[]).find(
      (o) => o.variable === "unibase_images",
    )?.value_selector,
    ["panel", "files"],
  );
  assert.equal(
    template.workflow.graph.nodes.find((n) => n.id === "panel")?.data.tool_name,
    "gpt_image_generate",
  );
});

test("LLMs receive raw tool context and review answers without Python extraction", () => {
  const { nodes, edges } = template.workflow.graph;
  const node = (id: string) => nodes.find((n) => n.id === id)!;
  assert.equal(
    nodes.some((n) => ["reference", "feedback"].includes(n.id)),
    false,
  );
  // Inspect every binding so removing a node cannot leave a dangling selector.
  for (const n of nodes) {
    for (const match of JSON.stringify(n.data).matchAll(
      /\{\{#([^.}]+)\.[^}]+#\}\}/g,
    )) {
      assert(
        match[1].startsWith("$") || nodes.some((n) => n.id === match[1]),
        match[0],
      );
    }
    const variables = (n.data.variables ?? []) as {
      value_selector?: string[];
    }[];
    for (const variable of variables)
      if (variable.value_selector)
        assert(nodes.some((n) => n.id === variable.value_selector![0]));
  }
  for (const [source, target] of [
    ["read", "story"],
    ["story_decision", "revised_story"],
  ]) {
    assert(edges.some((e) => e.source === source && e.target === target));
    assert.equal(node(target).data.type, "llm");
  }
  const prompts = (id: string) =>
    node(id).data.prompt_template as { role: string; text: string }[];
  assert(prompts("story").some((p) => p.text.includes("{{#read.json#}}")));
  const reviewPrompt = prompts("revised_story").find(
    (p) => p.role === "user",
  )!.text;
  assert(reviewPrompt.includes("{{#story_decision.response#}}"));
  const responder = orchestratorTemplate("persona-responder").build("fixture");
  const question = JSON.stringify({
    form_content: code("story_form", { story: "A robot finds a firefly." })
      .form,
  });
  for (const review of [
    { decision: "approved" },
    { decision: "changes", changes: "Give the robot a blue scarf." },
  ]) {
    const answer = { action: "continue", answers: { review } };
    assert.deepEqual(
      JSON.parse(code("compose", { answer, question }, responder).answer),
      answer,
    );
    const rendered = reviewPrompt.replace(
      "{{#story_decision.response#}}",
      JSON.stringify(answer.answers),
    );
    assert(rendered.includes(JSON.stringify(answer.answers)));
  }
  for (const revision of [-1, true, "4"])
    assert.throws(() =>
      code("draft", {
        story: "A robot finds a firefly.",
        character: "A silver robot.",
        reference: [{ artifactId: "fixture-artifact", revision }],
      }),
    );
});
