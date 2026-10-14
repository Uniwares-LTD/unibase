import assert from "node:assert/strict";
import { test } from "node:test";
import {
  rawResponseText,
  rawDecisionSubmitSchema,
  decisionSubmitSchema,
  decisionRequestSchema,
} from "../../src/lib/contracts/runs";
import { responderAnswer } from "../../src/lib/server/runs/responder";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import { randomUUID } from "node:crypto";

const form = {
  form_content: "Answer the question. {{#$output.response#}}",
  inputs: [{ type: "paragraph", output_variable_name: "response" }],
  user_actions: [{ id: "continue", title: "Continue" }],
};
const job = {
  inputs: { question: JSON.stringify(form) },
  responder: { responseMode: "raw-v1" as const },
};

test("raw persona responses preserve text and all JSON types without interpreting them", () => {
  for (const response of [
    "Approved, no changes.",
    '{"review":{"decision":"approved","changes":null}}',
    '```json\n{"decision":"approved"}\n```',
    "",
    null,
    false,
    0,
    1.5,
    ["a", null, 2],
    { review: { decision: "approved", changes: null } },
  ]) {
    const output = structuredClone({ answer: response });
    assert.deepEqual(responderAnswer(job, output), {
      action: "continue",
      response,
    });
    assert.deepEqual(output, { answer: response });
    const wire = rawResponseText(response);
    assert.deepEqual(
      typeof response === "string" ? wire : JSON.parse(wire),
      response,
    );
  }
  for (const answer of [undefined, Number.NaN, "x".repeat(4001)])
    assert.throws(() => responderAnswer(job, { answer }));
  assert.throws(() => rawResponseText({ text: "x".repeat(4000) }));
  assert.deepEqual(
    responderAnswer(
      { ...job, inputs: { question: "An ordinary question?" } },
      { answer: "An ordinary answer." },
    ),
    { action: "continue", response: "An ordinary answer." },
  );
});

test("raw and structured submission interfaces cannot silently reinterpret each other", () => {
  const base = { key: randomUUID(), action: "continue" };
  assert.equal(
    decisionRequestSchema.safeParse({ ...base, response: null }).success,
    true,
  );
  assert.equal(
    decisionRequestSchema.safeParse({ ...base, answers: {} }).success,
    true,
  );
  assert.equal(
    decisionRequestSchema.safeParse({ ...base, answers: {}, response: null })
      .success,
    false,
  );
  assert.equal(
    rawDecisionSubmitSchema.safeParse({ ...base, response: null }).success,
    true,
  );
  assert.equal(
    rawDecisionSubmitSchema.safeParse({ ...base, answers: {} }).success,
    false,
  );
  assert.equal(
    decisionSubmitSchema.safeParse({ ...base, response: {} }).success,
    false,
  );
  assert.equal(
    rawDecisionSubmitSchema.safeParse({ ...base, response: "yes", answers: {} })
      .success,
    false,
  );
});

test("raw registration requires the response transport and a continue action", () => {
  const graph =
    orchestratorTemplate("story-panel").build("fixture").workflow.graph;
  assert.doesNotThrow(() => inspectDifyWorkflow(graph, "raw-v1"));
  for (const change of [
    (data: Record<string, unknown>) => {
      data.inputs = [{ type: "file", output_variable_name: "response" }];
    },
    (data: Record<string, unknown>) => {
      data.user_actions = [{ id: "approve", title: "Approve" }];
    },
  ]) {
    const invalid = structuredClone(graph);
    const decision = invalid.nodes.find((n) => n.id === "story_decision")!;
    change(decision.data);
    assert.throws(() => inspectDifyWorkflow(invalid, "raw-v1"));
  }
});
