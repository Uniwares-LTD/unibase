import assert from "node:assert/strict";
import { test } from "node:test";
import { orchestratorTemplate } from "../../src/lib/server/runs/templates";
import { inspectDifyWorkflow } from "../../src/lib/server/runs/dify-capabilities";
import {
  privateContextInputName,
  publicRunInputs,
  orchestratorSchema,
} from "../../src/lib/contracts/runs";

type TestGraph = {
  nodes: {
    id: string;
    data: {
      type: string;
      provider_type?: string;
      variables?: {
        variable: string;
        type?: string;
        required?: boolean;
        value_selector?: string[];
      }[];
      tool_parameters?: Record<string, { type: string; value: unknown }>;
      [key: string]: unknown;
    };
  }[];
};
const graph = (): TestGraph =>
  orchestratorTemplate("saved-artifact").build("fixture").workflow
    .graph as TestGraph;
const legacyGraph = (): TestGraph =>
  JSON.parse(
    JSON.stringify(graph()).replaceAll('"context"', '"unibase_context"'),
  );

test("Private context rename preserves legacy snapshots and leaves ordinary public context available", () => {
  assert.equal(
    privateContextInputName({ contextInput: true }),
    "unibase_context",
  );
  assert.equal(
    privateContextInputName({
      contextInput: true,
      contextInputName: "context",
    }),
    "context",
  );
  for (const source of [graph(), legacyGraph()]) {
    const fit = inspectDifyWorkflow(source);
    assert.equal(fit.contextInput, true);
    assert.equal(
      fit.contextInputName,
      source.nodes[0].data.variables![0].variable,
    );
    assert.deepEqual(fit.inputs, []);
  }
  const publicGraph = {
    nodes: [
      {
        id: "start",
        data: {
          type: "start",
          variables: [
            { variable: "context", type: "text-input", required: true },
          ],
        },
      },
      { id: "end", data: { type: "end" } },
    ],
  };
  const fit = inspectDifyWorkflow(publicGraph);
  assert.equal(fit.inputs[0].name, "context");
  assert.equal(fit.contextInput, undefined);
  assert.deepEqual(
    publicRunInputs({ context: "public", unibase_run_id: "internal" }, {}),
    { context: "public" },
  );
  assert.deepEqual(
    publicRunInputs(
      { context: "private-token", prompt: "public" },
      { contextInput: true, contextInputName: "context" },
    ),
    { prompt: "public" },
  );
  assert.deepEqual(
    publicRunInputs(
      { context: "public", unibase_context: "private-token" },
      { contextInput: true },
    ),
    { context: "public" },
  );
  assert.equal(
    orchestratorSchema.safeParse({
      id: "private",
      name: "Private",
      description: "",
      order: 0,
      keyEnv: "DIFY_KEY_TEST",
      enabled: true,
      inputs: [
        {
          name: "context",
          label: "Context",
          kind: "text",
          required: true,
          options: [],
        },
      ],
      pricing: null,
      recovery: null,
      contextInput: true,
      contextInputName: "context",
    }).success,
    false,
  );
});

test("Private context cannot reach prompts, code variables, End outputs or extra tool arguments", () => {
  for (const original of [graph(), legacyGraph()]) {
    const name = original.nodes[0].data.variables![0].variable;
    for (const data of [
      {
        type: "llm",
        prompt_template: [{ role: "user", text: `{{#start.${name}#}}` }],
      },
      {
        type: "code",
        variables: [{ variable: "copy", value_selector: ["start", name] }],
      },
      {
        type: "end",
        outputs: [{ variable: "copy", value_selector: ["start", name] }],
      },
    ]) {
      const modified = structuredClone(original);
      modified.nodes.push({ id: "leak", data });
      assert.throws(() => inspectDifyWorkflow(modified), /Run context/);
    }
    const modified = structuredClone(original);
    const tool = modified.nodes.find((n) => n.data.provider_type === "mcp");
    tool!.data.tool_parameters!.copy = {
      type: "variable",
      value: ["start", name],
    };
    assert.throws(() => inspectDifyWorkflow(modified), /Do not copy/);
    const missing = structuredClone(original);
    missing.nodes[0].data.variables = [];
    assert.throws(() => inspectDifyWorkflow(missing), /context/);
    const optional = structuredClone(original);
    optional.nodes[0].data.variables![0].required = false;
    assert.throws(() => inspectDifyWorkflow(optional), /context/);
  }
});
