import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseUiForm,
  validateAnswers,
  parseResult,
  orchestratorSchema,
  difyInitialInputs,
} from "../src/lib/contracts/runs";
import { baseSettingsSchema } from "../src/lib/contracts/settings";
const card = {
  id: "preferences",
  content: {
    type: "form",
    version: 1,
    data: {
      title: "Preferences",
      explanation: "Choose",
      fields: [
        {
          id: "count",
          label: "Count",
          kind: "number",
          required: true,
          min: 1,
          max: 5,
        },
        { id: "include", label: "Include", kind: "toggle", required: true },
      ],
    },
  },
};
test("generated UI validates versions, field bounds and actions without executable content", () => {
  const form =
    "```unibase-ui\n" +
    JSON.stringify({ version: 1, cards: [card] }) +
    "\n```\n{{#$output.response#}}";
  const ui = parseUiForm(form);
  assert.deepEqual(
    validateAnswers(ui, { preferences: { count: 3, include: false } }),
    { preferences: { count: 3, include: false } },
  );
  for (const answers of [
    { preferences: { count: 6, include: true } },
    { preferences: { count: 3 } },
    { preferences: { count: 3, include: true, extra: "x" } },
    { forged: "x" },
  ])
    assert.throws(() => validateAnswers(ui, answers));
  assert.throws(() => parseUiForm(form + form));
  assert.throws(() => parseUiForm(form.replace('"version":1', '"version":2')));
  assert.throws(() => parseUiForm(form.replace('"form"', '"html"')));
  assert.throws(() => parseUiForm(form.replace('"form"', '"review"')));
});

test("Dify initial input fixtures reject unsupported controls and retain select contracts", () => {
  const fields = difyInitialInputs({
    user_input_form: [
      {
        "text-input": {
          variable: "unibase_run_id",
          label: "Run",
          required: true,
        },
      },
      {
        select: {
          variable: "direction",
          label: "Direction",
          options: ["brief", "detailed"],
          required: true,
        },
      },
    ],
  });
  assert.equal(fields[0].kind, "text");
  assert.deepEqual(fields[1].options, ["brief", "detailed"]);
  assert.throws(() =>
    difyInitialInputs({
      user_input_form: [{ "file-list": { variable: "files", label: "Files" } }],
    }),
  );
});
test("business outcome is structured and image and checkpoint references are bounded", () => {
  const result = {
    version: 1,
    outcome: "success",
    text: "The prose says failed",
    cards: [],
    images: [],
    checkpoint: null,
    failure: null,
  };
  assert.equal(
    parseResult({ result: JSON.stringify(result) }).outcome,
    "success",
  );
  assert.throws(() => parseResult({ text: "failed" }));
  assert.throws(() =>
    parseResult({
      result: {
        ...result,
        images: [{ id: "https://evil.test/private", url: "https://evil.test" }],
      },
    }),
  );
  assert.throws(() =>
    parseResult({
      result: {
        ...result,
        checkpoint: {
          version: "1",
          stage: "draft",
          data: { x: "y" },
          execute: "code",
        },
      },
    }),
  );
});
test("orchestrator inputs cannot override application correlation or duplicate fields", () => {
  const d = {
    id: "test",
    name: "Test",
    description: "",
    order: 0,
    keyEnv: "DIFY_KEY_TEST",
    enabled: false,
    inputs: [],
    pricing: null,
    recovery: null,
  };
  const field = {
    name: "unibase_run_id",
    label: "ID",
    kind: "text",
    required: true,
    options: [],
  };
  assert.throws(() => orchestratorSchema.parse({ ...d, inputs: [field] }));
  assert.throws(() =>
    orchestratorSchema.parse({
      ...d,
      inputs: [
        { ...field, name: "prompt" },
        { ...field, name: "prompt" },
      ],
    }),
  );
  assert.equal(orchestratorSchema.parse(d).keyEnv, "DIFY_KEY_TEST");
  assert.equal(
    baseSettingsSchema.shape.runs.shape.imageBytes.safeParse(9 * 1024 * 1024)
      .success,
    false,
  );
});
