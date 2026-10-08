import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createRegistry } from "../src/lib/creation/registry";
import {
  artifactRegistry,
  defineArtifact,
  legacyArtifactContent,
  parseArtifact,
} from "../src/lib/creation/artifacts";
import {
  cardRegistry,
  generatedCardSchema,
  parseCard,
} from "../src/lib/creation/cards";

const form = {
  title: "Preferences",
  explanation: "",
  fields: [
    {
      id: "title",
      label: "Title",
      kind: "text",
      multiline: false,
      maxLength: 8,
      required: true,
    },
    {
      id: "count",
      label: "Count",
      kind: "number",
      min: 1,
      max: 5,
      required: true,
    },
    { id: "confirm", label: "Confirm", kind: "toggle", required: true },
    {
      id: "choice",
      label: "Choice",
      kind: "choice",
      multiple: true,
      required: false,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    },
  ],
};
test("registry extensions pin versions and reject duplicates and unknown types", () => {
  const definition = defineArtifact({
    type: "note",
    version: 1,
    label: "Note",
    schema: z.strictObject({ heading: z.string(), value: z.number() }),
    project: (data) => ({
      title: data.heading,
      text: String(data.value),
      assetIds: [],
    }),
  });
  const registry = createRegistry([...artifactRegistry.list(), definition]);
  assert.deepEqual(
    registry.get("note", 1).project({ heading: "Count", value: 4 }),
    { title: "Count", text: "4", assetIds: [] },
  );
  assert.throws(() => registry.get("note", 2), /not registered/);
  assert.throws(() => createRegistry([definition, definition]), /Duplicate/);
  assert.throws(
    () => parseArtifact({ type: "script", version: 1, data: {} }),
    /not registered/,
  );
  assert.throws(() =>
    parseArtifact({
      type: "document",
      version: 1,
      data: { title: "Note", body: "Hello", html: "<script/>" },
    }),
  );
});
test("registered artifacts validate structured content and preserve legacy projections", () => {
  const content = parseArtifact({
    type: "checklist",
    version: 1,
    data: {
      title: "Tasks",
      items: [{ id: randomUUID(), text: "Verify", done: true }],
    },
  });
  assert.equal(
    artifactRegistry.get(content.type, content.version).project(content.data)
      .text,
    "[x] Verify",
  );
  assert.deepEqual(
    parseArtifact(
      legacyArtifactContent({ title: "Old", body: "Original", assetId: null }),
    ),
    { type: "document", version: 1, data: { title: "Old", body: "Original" } },
  );
});
test("generated forms validate offered actions, required fields, bounds and exact choices", () => {
  const content = parseCard({ type: "form", version: 1, data: form }, true);
  const definition = cardRegistry.get(content.type, content.version);
  const response = { title: "Hello", count: 3, confirm: false, choice: ["a"] };
  assert.deepEqual(
    definition.response(content.data, "submit", response),
    response,
  );
  for (const invalid of [
    { ...response, secret: "unexpected" },
    { ...response, title: "too long a title" },
    { ...response, count: "3" },
    { ...response, count: 6 },
    { ...response, choice: ["a", "a"] },
    { ...response, choice: ["other"] },
    { count: 3, confirm: true },
  ])
    assert.throws(() => definition.response(content.data, "submit", invalid));
  assert.throws(
    () => definition.response(content.data, "approve", response),
    /not offered/,
  );
  assert.equal(
    generatedCardSchema.safeParse({
      type: "form",
      version: 1,
      data: { ...form, fields: [form.fields[0], form.fields[0]] },
    }).success,
    false,
  );
  assert.equal(
    generatedCardSchema.safeParse({
      type: "form",
      version: 1,
      data: { ...form, fields: [{ ...form.fields[0], id: "__proto__" }] },
    }).success,
    false,
  );
});
test("models cannot issue approval/progress authority or executable card controls", () => {
  for (const type of ["review", "progress", "script"])
    assert.equal(
      generatedCardSchema.safeParse({ type, version: 1, data: {} }).success,
      false,
    );
  assert.equal(
    generatedCardSchema.safeParse({
      type: "summary",
      version: 1,
      data: { title: "Text", body: "Hello", onClick: "fetch('/admin')" },
    }).success,
    false,
  );
  const definition = cardRegistry.get("gallery", 1);
  const id = randomUUID();
  const data = { title: "Choose", items: [{ assetId: id, label: "First" }] };
  assert.equal(definition.response(data, "choose", id), id);
  assert.throws(
    () => definition.response(data, "choose", randomUUID()),
    /offered/,
  );
  assert.deepEqual(definition.assets(data), [id]);
  assert.throws(
    () =>
      cardRegistry
        .get("issue", 1)
        .response(
          { title: "Check", severity: "blocking", details: ["Check claim"] },
          "approve",
          null,
        ),
    /not offered/,
  );
});
