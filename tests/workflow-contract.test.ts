import assert from "node:assert/strict";
import { test } from "node:test";
import { workflowDefinitionSchema } from "../src/lib/contracts/workflow";
import { workflowTemplates } from "../src/lib/creation/workflows";
test("workflow definitions reject cycles, missing dependencies and ambiguous automatic selection", () => {
  const definition = workflowTemplates.get("draft-review", 1).definition;
  assert.ok(workflowDefinitionSchema.safeParse(definition).success);
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [definition.steps[0], definition.steps[0]],
    }).success,
    false,
  );
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [
        { ...definition.steps[0], dependsOn: ["approval"] },
        ...definition.steps.slice(1),
      ],
    }).success,
    false,
  );
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [{ ...definition.steps[0], dependsOn: ["missing"] }],
    }).success,
    false,
  );
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [{ ...definition.steps[0], count: 2 }],
    }).success,
    false,
  );
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [{ ...definition.steps[0], script: "unsafe" }],
    }).success,
    false,
  );
  assert.equal(
    workflowDefinitionSchema.safeParse({
      ...definition,
      steps: [
        { ...definition.steps[1], dependsOn: [], target: { kind: "new" } },
      ],
    }).success,
    false,
  );
});
