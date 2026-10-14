import assert from "node:assert/strict";
import { test } from "node:test";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import { responderAnswer } from "../../src/lib/server/runs/responder";

test("Persona template is a raw Start/LLM/End pass-through without Python or an output schema", () => {
  const graph =
    orchestratorTemplate("persona-responder").build("fixture").workflow.graph;
  assert.deepEqual(
    graph.nodes.map((n) => n.data.type),
    ["start", "llm", "end"],
  );
  assert.equal(graph.nodes[1].data.structured_output_enabled, false);
  assert.equal(graph.nodes[1].data.structured_output, undefined);
  assert.deepEqual(graph.nodes[2].data.outputs, [
    { variable: "answer", value_selector: ["answer", "text"] },
  ]);
  assert.deepEqual(
    graph.edges.map((e) => [e.source, e.target]),
    [
      ["start", "answer"],
      ["answer", "end"],
    ],
  );
  const fit = inspectDifyWorkflow(graph);
  assert.equal(fit.purpose, "responder");
  assert.deepEqual(
    fit.inputs.map((f) => f.name),
    ["persona", "question", "context"],
  );
  assert.equal(fit.contextInput, undefined);
});

test("Raw LLM answer text preserves native form value types at Unibase submission", () => {
  const card = {
    id: "review",
    content: {
      type: "form",
      version: 1,
      data: {
        title: "Any field types",
        explanation: "",
        fields: [
          {
            id: "text",
            kind: "text",
            label: "Text",
            required: true,
            multiline: true,
            maxLength: 4000,
          },
          {
            id: "number",
            kind: "number",
            label: "Number",
            required: true,
            min: 0,
            max: 10,
          },
          { id: "toggle", kind: "toggle", label: "Toggle", required: true },
          {
            id: "changes",
            kind: "text",
            label: "Changes",
            required: false,
            multiline: true,
            maxLength: 4000,
          },
          {
            id: "choices",
            kind: "choice",
            label: "Choices",
            required: true,
            multiple: true,
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
          },
        ],
      },
    },
  };
  const question = JSON.stringify({
    form_content:
      "```unibase-ui\n" +
      JSON.stringify({ version: 1, cards: [card] }) +
      "\n```\n{{#$output.response#}}",
    inputs: [],
    user_actions: [{ id: "continue", title: "Continue" }],
    resolved_default_values: {},
  });
  const answer = {
    action: "continue",
    answers: {
      review: {
        text: "A short answer",
        number: 3,
        toggle: false,
        choices: ["a", "b"],
      },
    },
  };
  assert.deepEqual(
    responderAnswer(
      { inputs: { question } },
      { answer: JSON.stringify(answer) },
    ),
    answer,
  );
  assert.deepEqual(
    responderAnswer(
      { inputs: { question } },
      { answer: JSON.stringify(answer.answers) },
    ),
    answer,
  );
  for (const changes of [null, undefined]) {
    const raw = { review: { ...answer.answers.review, changes } };
    for (const output of [raw, { action: "continue", answers: raw }])
      assert.deepEqual(
        responderAnswer(
          { inputs: { question } },
          { answer: JSON.stringify(output) },
        ),
        answer,
      );
  }
  const ambiguousQuestion = JSON.stringify({
    ...JSON.parse(question),
    user_actions: [
      { id: "approve", title: "Approve" },
      { id: "decline", title: "Decline" },
    ],
  });
  assert.throws(() =>
    responderAnswer(
      { inputs: { question: ambiguousQuestion } },
      { answer: JSON.stringify(answer.answers) },
    ),
  );
  assert.deepEqual(
    responderAnswer(
      { inputs: { question: ambiguousQuestion } },
      { answer: JSON.stringify({ ...answer, action: "approve" }) },
    ),
    { ...answer, action: "approve" },
  );
  for (const invalid of [
    { action: "continue" },
    { answers: answer.answers },
    { review: { ...answer.answers.review, number: 11 } },
    { review: { ...answer.answers.review, text: null } },
    { review: { ...answer.answers.review, changes: 42 } },
    { review: { ...answer.answers.review, changes: "x".repeat(4001) } },
    { review: { ...answer.answers.review, unknown: null } },
    { ...answer.answers, unknown: "unexpected" },
  ])
    assert.throws(() =>
      responderAnswer(
        { inputs: { question } },
        { answer: JSON.stringify(invalid) },
      ),
    );
  assert.throws(() =>
    responderAnswer(
      { inputs: { question } },
      { answer: JSON.stringify({ ...answer, action: "unoffered" }) },
    ),
  );
  assert.throws(() =>
    responderAnswer(
      { inputs: { question } },
      { answer: JSON.stringify({ action: "continue", answers: ":{" }) },
    ),
  );
});
