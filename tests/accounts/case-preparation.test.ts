import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import {
  parseResult,
  parseUiForm,
  validateAnswers,
} from "../../src/lib/contracts/runs";
import { artifactDraftSchema } from "../../src/lib/contracts/artifacts";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";

const template = orchestratorTemplate("case-preparation");
const graph = template.build("authorized-provider").workflow.graph;
function code(id: string, args: Record<string, unknown>) {
  const node = graph.nodes.find((n) => n.id === id)!;
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
const reference = [
  { artifactId: "00000000-0000-4000-8000-000000000001", revision: 4 },
];
const law = {
  title: "Fictional demonstration law",
  content: "Synthetic text for testing, not a real country's law.",
  metadata: {
    document_id: "fixture-document",
    segment_id: "fixture-segment",
    article: "Sample 1",
    effective_date: "not supplied",
  },
};

test("Case preparation admits owned multimodal inputs, requires destination setup and keeps private context out of prompts", () => {
  const fit = inspectDifyWorkflow(graph, "raw-v1");
  assert.equal(template.setupRequired, true);
  assert.deepEqual(
    fit.inputs.map((f) => [f.name, f.kind, f.required]),
    [
      ["notes", "paragraph", true],
      ["document", "file", false],
      ["image", "file", false],
      ["audio", "file", false],
    ],
  );
  assert.equal(fit.contextInputName, "context");
  assert.deepEqual(
    code("configuration", { jurisdiction: "  Configured jurisdiction  " }),
    { jurisdiction: "Configured jurisdiction" },
  );
  for (const jurisdiction of ["", " ", "x".repeat(201), null])
    assert.throws(
      () => code("configuration", { jurisdiction }),
      /Set the jurisdiction/,
    );
  assert.throws(() => code("read_document", { text: "" }), /OCR/);
  assert.throws(
    () => code("read_document", { text: "x".repeat(30001) }),
    /split/,
  );
  assert.equal(
    code("read_document", { text: "Evidence text" }).text,
    "Evidence text",
  );
  for (const field of ["image", "audio"]) {
    const node = graph.nodes.find((n) => n.id === "read_" + field)!;
    assert.deepEqual((node.data.vision as { configs: unknown }).configs, {
      variable_selector: ["start", field],
      detail: "high",
    });
  }
});

test("Legal citation validation accepts retrieved IDs and rejects fabricated, missing or malformed references", () => {
  const sources = code("sources", { result: [law] });
  const parsed = JSON.parse(sources.context);
  assert.equal(parsed[0].content, law.content);
  assert.equal(parsed[0].metadata.segment_id, "fixture-segment");
  assert.equal(sources.has_sources, "yes");
  const analysis = {
    analysis: [
      { text: "Conditional demonstration analysis.", citations: ["L1"] },
    ],
    questions: ["Is the supplied version applicable?"],
    limitations: ["Currency is unverified."],
  };
  const text = code("validated_analysis", {
    answer: JSON.stringify(analysis),
    context: sources.context,
  }).text;
  assert.match(text, /\[L1\]/);
  for (const citations of [[], ["L2"], [null], "L1"])
    assert.throws(
      () =>
        code("validated_analysis", {
          answer: JSON.stringify({
            ...analysis,
            analysis: [{ text: "Unsupported", citations }],
          }),
          context: sources.context,
        }),
      /citation/,
    );
  assert.throws(() =>
    code("validated_analysis", { answer: "prose", context: sources.context }),
  );
  assert.throws(
    () =>
      code("validated_analysis", {
        answer: JSON.stringify(analysis),
        context: "[]",
      }),
    /needs retrieved/,
  );
  assert.throws(
    () => code("sources", { result: [{ ...law, content: "x".repeat(12001) }] }),
    /chunking/,
  );
  assert.equal(
    code("sources", { result: [{ content: " " }] }).has_sources,
    "no",
  );
  const draft = code("draft", {
    facts: "Client alleges a missed delivery [NOTES].",
    legal: text,
    context: sources.context,
    jurisdiction: "Configured jurisdiction",
    reference,
  });
  artifactDraftSchema.parse({
    operationKey: "case-brief",
    expectedRevision: draft.revision,
    text: draft.text,
  });
  assert.match(draft.text, /fixture-segment/);
  assert(draft.text.includes(law.content));
  assert.equal(draft.revision, 4);
  assert.throws(
    () =>
      code("draft", {
        facts: "x".repeat(2001),
        legal: text,
        context: sources.context,
        jurisdiction: "Configured jurisdiction",
        reference,
      }),
    /Invalid reviewed facts/,
  );
});

test("Empty legal retrieval bypasses the analysis LLM and produces an explicitly partial factual brief", () => {
  const sources = code("sources", { result: [] });
  assert.equal(sources.has_sources, "no");
  const route = graph.edges.find(
    (e) => e.source === "has_laws" && e.sourceHandle === "false",
  )!;
  assert.equal(route.target, "no_laws");
  const legal = code("no_laws", {}).text;
  assert.match(legal, /Insufficient legal sources/);
  const draft = code("draft", {
    facts: "Client allegation [NOTES].",
    legal,
    context: sources.context,
    jurisdiction: "Configured jurisdiction",
    reference,
  });
  const result = parseResult(
    code("finish", { text: draft.text, has_sources: "no" }),
  );
  assert.equal(result.outcome, "partial");
  assert.match(result.text, /factual preparation brief only/);
});

test("Fact review accepts corrections; final approval binds the saved revision and requires a human", () => {
  const review = parseUiForm(
    code("facts_form", {
      facts: "Conflicting delivery dates [DOCUMENT] [NOTES].",
    }).form + "\n{{#$output.response#}}",
  );
  assert.deepEqual(
    validateAnswers(review, {
      review: { corrections: "The interview date is uncertain." },
    }),
    { review: { corrections: "The interview date is uncertain." } },
  );
  assert.throws(() =>
    validateAnswers(review, { review: { corrections: "x".repeat(4001) } }),
  );
  const form = parseUiForm(
    code("form", {
      reference: [
        { ...reference[0], revision: 5, contentHash: "a".repeat(64) },
      ],
      text: "Reviewed case brief",
    }).form + "\n{{#$output.response#}}",
  );
  assert.equal(form.approval?.requireHuman, true);
  assert.equal(form.approval?.revision, 5);
  assert.equal(form.approval?.contentHash, "a".repeat(64));
  assert.deepEqual(
    graph.edges
      .filter((e) => e.target === "approve")
      .map((e) => [e.source, e.sourceHandle]),
    [["approval", "approve"]],
  );
  for (const action of ["decline", "continue"])
    assert.equal(
      graph.edges.find(
        (e) => e.source === "approval" && e.sourceHandle === action,
      )?.target,
      "declined",
    );
  const end = graph.nodes.find((node) => node.id === "declined_end")!;
  const output = (
    end.data.outputs as { variable: string; value_selector: string[] }[]
  )[0];
  const declined = code("declined", { text: "Reviewed case brief" });
  assert.equal(
    parseResult({ [output.variable]: declined[output.value_selector[1]] })
      .outcome,
    "partial",
  );
});
