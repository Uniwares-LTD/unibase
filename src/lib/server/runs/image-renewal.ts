import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import type { AiJob } from "../ai/jobs";
import { fingerprint } from "../ai/jobs";
import { difyJson } from "./dify-console-client";
import { providerImages } from "./provider-images";
import storyPanel from "./templates/story-panel.json";

type File = ReturnType<typeof providerImages>[number];
const validator = storyPanel.dsl.workflow.graph.nodes.find(
  (node) => node.id === "validate_image1",
)!;
const graphSchema = z.object({
  nodes: z
    .array(
      z.object({ id: z.string(), data: z.record(z.string(), z.unknown()) }),
    )
    .max(1000),
});
function contract(data: Record<string, unknown>) {
  const value = z
    .json()
    .safeParse([
      data.type,
      data.code_language,
      data.code,
      data.variables,
      data.outputs,
    ]);
  return value.success ? fingerprint(value.data) : null;
}

// Dify rehydrates typed file inputs before this single Code node executes. Never
// invoke a workflow or an image tool, rewrite a draft, or accept replacement files.
// This deliberately supports only the shipped Unitale validator, not arbitrary code.
export async function renewProviderImage(
  job: AiJob,
  file: File,
  request: typeof difyJson = difyJson,
): Promise<File> {
  const unavailable = () =>
    new AppError(
      "RESULT_MEDIA_UNAVAILABLE",
      "Completed images need provider-authorized recovery.",
      409,
    );
  if (job.binding.mode !== "live" || !job.runId || !job.run?.orchestrator.appId)
    throw unavailable();
  const app = z.string().uuid().parse(job.run.orchestrator.appId);
  const run = z.string().uuid().parse(job.runId);
  const prefix = `/apps/${app}`;
  const original = z
    .object({
      id: z.literal(run),
      status: z.literal("succeeded"),
      graph: graphSchema,
      outputs: z.record(z.string(), z.unknown()),
    })
    .parse(
      await request(`${prefix}/workflow-runs/${run}`, { management: true }),
    );
  if (
    !providerImages(original.outputs).some(
      (item) => item.related_id === file.related_id,
    )
  )
    throw unavailable();
  const draft = z
    .object({ graph: graphSchema })
    .parse(await request(`${prefix}/workflows/draft`, { management: true }));
  const trusted = contract(validator.data);
  for (const graph of [original.graph, draft.graph]) {
    const node = graph.nodes.find((n) => n.id === validator.id);
    if (!node || contract(node.data) !== trusted) throw unavailable();
  }
  const response = z
    .object({
      node_id: z.literal(validator.id),
      status: z.literal("succeeded"),
      outputs: z.object({ files: z.array(z.unknown()).length(1) }),
    })
    .parse(
      await request(`${prefix}/workflows/draft/nodes/${validator.id}/run`, {
        management: true,
        body: {
          inputs: {
            "validate_image1.files": [file],
            "validate_image1.error": "",
          },
        },
      }),
    );
  const [renewed] = providerImages({
    result: original.outputs.result,
    unibase_images: response.outputs.files,
  });
  if (renewed.related_id !== file.related_id) throw unavailable();
  return renewed;
}
