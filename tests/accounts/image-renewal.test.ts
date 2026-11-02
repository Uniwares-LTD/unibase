import assert from "node:assert/strict";
import { test } from "node:test";
import { renewProviderImage } from "../../src/lib/server/runs/image-renewal";
import type { AiJob } from "../../src/lib/server/ai/jobs";
import type { difyJson } from "../../src/lib/server/runs/dify-console-client";
import storyPanel from "../../src/lib/server/runs/templates/story-panel.json";

const app = "00000000-0000-4000-8000-000000000001";
const run = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const file = {
  type: "image" as const,
  transfer_method: "tool_file" as const,
  related_id: id,
  url: `/files/tools/${id}.png?timestamp=1&nonce=n&sign=old`,
};
const result = {
  version: 1,
  outcome: "success",
  text: "Comic",
  cards: [],
  images: [],
};
const job = {
  binding: { mode: "live" },
  runId: run,
  run: { orchestrator: { appId: app } },
} as AiJob;
const node = storyPanel.dsl.workflow.graph.nodes.find(
  (n) => n.id === "validate_image1",
)!;
function fixture(
  options: { draft?: unknown; original?: unknown; returnedId?: string } = {},
) {
  const calls: { path: string; options: Parameters<typeof difyJson>[1] }[] = [];
  const request: typeof difyJson = async (path, args) => {
    calls.push({ path, options: args });
    if (path.endsWith(`/workflow-runs/${run}`))
      return (
        options.original ?? {
          id: run,
          status: "succeeded",
          graph: { nodes: [node] },
          outputs: { result, unibase_images: [file] },
        }
      );
    if (path.endsWith("/workflows/draft"))
      return options.draft ?? { graph: { nodes: [node] } };
    assert.equal(
      path,
      `/apps/${app}/workflows/draft/nodes/validate_image1/run`,
    );
    assert.deepEqual(args?.body, {
      inputs: { "validate_image1.files": [file], "validate_image1.error": "" },
    });
    return {
      node_id: node.id,
      status: "succeeded",
      outputs: {
        files: [
          {
            ...file,
            related_id: options.returnedId ?? id,
            url: file.url.replace("old", "fresh"),
          },
        ],
      },
    };
  };
  return { request, calls };
}
test("renewal only executes the bundled Code validator and preserves the original file identity", async () => {
  const { request, calls } = fixture();
  const fresh = await renewProviderImage(job, file, request);
  assert.equal(fresh.related_id, id);
  assert.equal(fresh.url.endsWith("fresh"), true);
  assert.equal(calls.length, 3);
  assert.equal(
    calls.every((c) => c.options?.management),
    true,
  );
  assert.equal(calls.filter((c) => c.options?.body).length, 1);
});
test("foreign Run files and modified or missing draft validators never execute", async () => {
  for (const options of [
    {
      original: {
        id: run,
        status: "succeeded",
        graph: { nodes: [node] },
        outputs: { result, unibase_images: [{ ...file, related_id: app }] },
      },
    },
    { draft: { graph: { nodes: [] } } },
    {
      draft: {
        graph: { nodes: [{ ...node, data: { ...node.data, type: "tool" } }] },
      },
    },
    {
      draft: {
        graph: {
          nodes: [{ ...node, data: { ...node.data, code: "untrusted code" } }],
        },
      },
    },
    {
      draft: {
        graph: { nodes: [{ ...node, data: { ...node.data, variables: [] } }] },
      },
    },
    {
      original: {
        id: app,
        status: "succeeded",
        graph: { nodes: [node] },
        outputs: { result, unibase_images: [file] },
      },
    },
    {
      original: {
        id: run,
        status: "running",
        graph: { nodes: [node] },
        outputs: { result, unibase_images: [file] },
      },
    },
  ]) {
    const { request, calls } = fixture(options);
    await assert.rejects(renewProviderImage(job, file, request));
    assert.equal(
      calls.some((c) => c.options?.body !== undefined),
      false,
    );
  }
});
test("renewal rejects replacement files and non-live attempts", async () => {
  const { request } = fixture({ returnedId: app });
  await assert.rejects(renewProviderImage(job, file, request), /recovery/);
  await assert.rejects(
    renewProviderImage(
      { ...job, binding: { ...job.binding, mode: "fake" } },
      file,
      async () => {
        throw Error("Must not request");
      },
    ),
    /recovery/,
  );
});
