import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  difyWorkflowVersions,
  selectedWorkflowVersion,
} from "../../src/lib/server/runs/workflow-versions";
import { managementCommandSchema } from "../../src/lib/contracts/orchestrator-management";
import type { difyJson } from "../../src/lib/server/runs/dify-console-client";

test("Version pages exclude drafts and expose only bounded metadata", async () => {
  const appId = randomUUID();
  const row = {
    id: randomUUID(),
    version: "2026-10-14 12:00:00",
    created_at: 1760443200,
    version_number: null,
    marked_name: "",
    graph: { secretGraph: "canary" },
    environment_variables: [{ name: "secret", value: "private-canary" }],
    created_by: { email: "private@example.test" },
  };
  const request: typeof difyJson = async (path, options) => {
    assert.equal(path, `/apps/${appId}/workflows?page=2&limit=10`);
    assert.equal(options?.management, true);
    assert.equal(options?.body, undefined);
    return {
      items: [{ ...row, id: randomUUID(), version: "draft" }, row],
      page: 2,
      has_more: true,
    };
  };
  const result = await difyWorkflowVersions(appId, 2, request);
  assert.deepEqual(result, {
    versions: [
      {
        id: row.id,
        name: "",
        number: null,
        version: row.version,
        createdAt: row.created_at,
      },
    ],
    page: 2,
    hasMore: true,
  });
  assert.deepEqual(
    await selectedWorkflowVersion(
      appId,
      { workflowId: row.id, page: 2 },
      request,
    ),
    {
      id: row.id,
      version: row.version,
      created_at: row.created_at,
      version_number: null,
      marked_name: "",
      graph: row.graph,
      environment_variables: row.environment_variables,
    },
  );
  await assert.rejects(
    difyWorkflowVersions(appId, 2, async () => ({
      items: Array(11).fill(row),
      page: 2,
      has_more: false,
    })),
  );
  await assert.rejects(
    difyWorkflowVersions(appId, 2, async () => ({
      items: [row],
      page: 1,
      has_more: false,
    })),
  );
});

test("Management selections allow only an app, UUID and bounded page; legacy registration stays valid", () => {
  const appId = randomUUID(),
    workflowId = randomUUID();
  assert(
    managementCommandSchema.safeParse({ action: "register", appId }).success,
  );
  assert(
    managementCommandSchema.safeParse({
      action: "register",
      appId,
      selection: { workflowId, page: 3 },
    }).success,
  );
  assert.deepEqual(
    managementCommandSchema.parse({ action: "versions", appId }),
    { action: "versions", appId, page: 1 },
  );
  const copy = {
    action: "copy",
    appId,
    key: randomUUID(),
    selection: { workflowId, page: 1 },
  };
  assert(managementCommandSchema.safeParse(copy).success);
  assert.equal(
    managementCommandSchema.safeParse({ ...copy, environment: "production" })
      .success,
    false,
  );
  assert.equal(
    managementCommandSchema.safeParse({ ...copy, selection: undefined })
      .success,
    false,
  );
  for (const selection of [
    { workflowId, page: 0 },
    { workflowId, page: 100000 },
    { workflowId: "draft", page: 1 },
    { workflowId, page: 1, graph: {} },
  ])
    assert.equal(
      managementCommandSchema.safeParse({
        action: "register",
        appId,
        selection,
      }).success,
      false,
    );
});
