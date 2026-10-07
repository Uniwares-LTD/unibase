import "server-only";

import { z } from "zod";
import {
  studioInputSchema,
  studioOutputSchema,
  reviewSchema,
  imageOutputSchema,
} from "@/lib/contracts/workspace";
import { validatedImage } from "../workspaces/assets";
import { AppError } from "@/lib/auth-policy";
import { parseDifyConfig, type DifyConfig } from "@/lib/config/dify";
import {
  parseAiPricing,
  maximumCredits,
  type AiPricing,
} from "@/lib/config/ai-pricing";
import { createDifyWorkflow, providerUser } from "./dify";
import { createDifyChat } from "./chat";
import type { ClientSession, Db } from "mongodb";
import { resolveOwnedAiFile, type AiFileType } from "./files";
import { fingerprint, type AiJob, type BindingSnapshot } from "./jobs";
import type { Json, ProviderExecution, WorkflowProvider } from "./types";

export type AiCapability = {
  name: string;
  version: string;
  title: string;
  credits: number;
  kind: "workflow" | "chat";
  files?: {
    input: string;
    providerInput: string;
    types: readonly AiFileType[];
  }[];
  parseInput: (value: unknown) => Record<string, Json>;
  validOutput: (value: unknown) => boolean | Promise<boolean>;
  prepare?: (
    db: Db,
    job: AiJob,
    inputs: Record<string, Json>,
  ) => Promise<Record<string, Json>>;
  // Database-only hook. MongoDB may retry it; external calls do not belong here.
  materialize?: (
    db: Db,
    job: AiJob,
    result: ProviderExecution,
    session: ClientSession,
  ) => Promise<void>;
};
// Feature modules register their own validated contracts here. The transport and
// execution store do not import product schemas or infer prices from the client.
const capabilities: readonly AiCapability[] = [
  ...[
    {
      name: "workspace-compose",
      title: "Generate questions or a draft",
      output: studioOutputSchema,
    },
    {
      name: "workspace-review",
      title: "Review an artifact",
      output: reviewSchema,
    },
    {
      name: "workspace-image",
      title: "Generate an image",
      output: imageOutputSchema,
    },
  ].map(({ name, title, output }): AiCapability => ({
    name,
    title,
    version: "1",
    credits: 1,
    kind: "workflow",
    parseInput: (value) => studioInputSchema.parse(value),
    validOutput: async (value) => {
      if (!output.safeParse(value).success) return false;
      if (name === "workspace-image") {
        try {
          await validatedImage(imageOutputSchema.parse(value).png);
        } catch {
          return false;
        }
      }
      return true;
    },
  })),
  {
    name: "document-summary",
    version: "1",
    title: "Document or image summary",
    credits: 1,
    kind: "workflow",
    files: [
      {
        input: "fileId",
        providerInput: "document",
        types: ["document", "image"],
      },
    ],
    parseInput: (value) =>
      z
        .strictObject({
          prompt: z.string().trim().min(1).max(10_000),
          fileId: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(value),
    validOutput: (value) =>
      z.object({ text: z.string().max(100_000) }).safeParse(value).success,
  },
  {
    name: "assistant-text",
    kind: "workflow",
    version: "1",
    title: "Text assistant",
    credits: 1,
    parseInput: (value) =>
      z
        .strictObject({ prompt: z.string().trim().min(1).max(10_000) })
        .parse(value),
    validOutput: (value) =>
      z.object({ text: z.string().max(100_000) }).safeParse(value).success,
  },
  {
    name: "assistant-chat",
    kind: "chat",
    version: "1",
    title: "Conversation",
    credits: 1,
    parseInput: (value) =>
      z
        .strictObject({ prompt: z.string().trim().min(1).max(10_000) })
        .parse(value),
    validOutput: (value) =>
      z.object({ text: z.string().max(100_000) }).safeParse(value).success,
  },
];

export async function prepareAiInputs(
  db: Db,
  job: AiJob,
): Promise<Record<string, Json>> {
  const selected = capability(job.capability, job.capabilityVersion);
  const inputs = { ...selected.parseInput(job.inputs) };
  for (const file of selected.files ?? []) {
    inputs[file.providerInput] = [
      await resolveOwnedAiFile(
        db,
        job.uid,
        job.binding,
        String(inputs[file.input]),
        file.types,
      ),
    ];
    delete inputs[file.input];
  }
  return selected.prepare ? selected.prepare(db, job, inputs) : inputs;
}

export async function materializeAiResult(
  db: Db,
  job: AiJob,
  result: ProviderExecution,
  session: ClientSession,
) {
  await capability(job.capability, job.capabilityVersion).materialize?.(
    db,
    job,
    result,
    session,
  );
}

export function aiConfig() {
  return parseDifyConfig(process.env);
}
export function capabilityPricing(selected: AiCapability): AiPricing {
  return (
    parseAiPricing(process.env)[selected.name] ?? {
      mode: "fixed",
      credits: selected.credits,
    }
  );
}
export function capability(name: string, version?: string) {
  const found = capabilities.find(
    (item) => item.name === name && (!version || item.version === version),
  );
  if (!found)
    throw new AppError(
      "AI_CAPABILITY_UNAVAILABLE",
      "This AI capability is unavailable.",
      503,
    );
  return found;
}
export function availableCapabilities(config = aiConfig()) {
  return capabilities
    .filter(
      (item) =>
        config.mode === "fake" ||
        (config.mode === "live" &&
          config.bindings.some(
            (binding) =>
              binding.name === item.name && binding.kind === item.kind,
          )),
    )
    .map((item) => {
      const pricing = capabilityPricing(item);
      return {
        name: item.name,
        version: item.version,
        title: item.title,
        credits: maximumCredits(pricing),
        pricing,
        pricingKey: fingerprint(pricing),
        kind: item.kind,
        acceptsFile: Boolean(item.files?.length),
        simulated: config.mode === "fake",
      };
    });
}
export function bindingSnapshot(
  name: string,
  config: DifyConfig,
): BindingSnapshot {
  if (config.mode === "fake")
    return {
      name,
      revision: "fake-1",
      mode: "fake",
      kind: capability(name).kind,
      fingerprint: fingerprint(["fake", name, "1"]),
    };
  if (config.mode !== "live")
    throw new AppError("AI_DISABLED", "AI execution is disabled.", 503);
  const binding = config.bindings.find(
    (item) => item.name === name && item.kind === capability(name).kind,
  );
  if (!binding)
    throw new AppError(
      "AI_BINDING_UNAVAILABLE",
      "This AI capability is not configured.",
      503,
    );
  return {
    name,
    revision: binding.revision,
    kind: binding.kind,
    mode: "live",
    fingerprint: fingerprint([
      config.baseUrl,
      binding.apiKey,
      binding.workflowId ?? null,
      binding.revision,
      binding.kind,
    ]),
  };
}

function fakeId(hash: string, suffix: string) {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 30)}${suffix}`;
}
function fakeWorkflow(job: AiJob): WorkflowProvider {
  const runId = fakeId(job._id, "01");
  const taskId = fakeId(job._id, "02");
  const execution: ProviderExecution = {
    runId,
    workflowId: job.binding.kind === "chat" ? null : fakeId(job._id, "03"),
    status: "succeeded",
    outputs: fakeOutputs(job),
    usage: {
      scope: job.binding.kind === "chat" ? "message" : "execution",
      id: runId,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cost: null,
      elapsedMs: 0,
    },
  };
  if (job.pricing && job.pricing.mode !== "fixed") {
    // Deterministic billing fixtures, explicitly identified as fake in aiUsage.
    execution.usage.inputTokens = 1000;
    execution.usage.outputTokens = 500;
    execution.usage.totalTokens = 1500;
    execution.usage.cost = {
      amount: "0.0025",
      currency: "USD",
      source: "provider",
    };
  }
  return {
    async start(_input, observe) {
      await observe({
        type: "identity",
        runId,
        taskId,
        ...(job.binding.kind === "chat"
          ? { providerConversationId: fakeId(job.conversationId!, "04") }
          : {}),
      });
      await observe({ type: "execution", execution });
      return { kind: "ok", value: execution };
    },
    async retrieve(id) {
      return id === runId
        ? { kind: "ok", value: execution }
        : { kind: "unknown", failure: "invalid-response" };
    },
    async stop() {
      return { kind: "ok", value: undefined };
    },
  };
}
function fakeOutputs(job: AiJob): Record<string, Json> {
  const prompt = String(job.inputs.prompt ?? "");
  if (job.capability === "workspace-compose") {
    if (/question/i.test(prompt))
      return {
        type: "question",
        question: {
          kind: "single",
          title: "Which direction should the draft take?",
          explanation:
            "Simulated question. Your decision is saved in this workspace.",
          options: [
            { id: "concise", label: "Concise" },
            { id: "detailed", label: "Detailed" },
          ],
        },
      };
    return {
      type: "draft",
      draft: {
        title: "Simulated draft",
        body: `${prompt}\n\nCandidate ${job._id.slice(0, 8)}. This is a simulated result.`,
      },
    };
  }
  if (job.capability === "workspace-review")
    return {
      summary: "Simulated review; evaluate the content before approving.",
      issues: [
        {
          severity: "suggestion",
          message: "Check the draft against your intended audience.",
        },
      ],
    };
  if (job.capability === "workspace-image")
    return {
      title: "Simulated image",
      png: "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWNIKen+jw8zjAwFAGqamIFJPsH4AAAAAElFTkSuQmCC",
    };
  return { text: `Simulated response: ${prompt}` };
}
export function providerForJob(
  job: AiJob,
  config = aiConfig(),
): WorkflowProvider {
  const current = bindingSnapshot(job.binding.name, config);
  if (
    current.fingerprint !== job.binding.fingerprint ||
    current.mode !== job.binding.mode
  )
    throw new AppError(
      "AI_BINDING_CHANGED",
      "Restore the execution's provider binding before reconciling it.",
      503,
    );
  if (config.mode === "fake") return fakeWorkflow(job);
  if (config.mode !== "live")
    throw new AppError("AI_DISABLED", "AI execution is disabled.", 503);
  if (job.binding.kind === "chat")
    return createDifyChat(
      config,
      config.bindings.find((item) => item.name === job.binding.name)!,
      {
        user: providerUser(job.uid),
        conversationId: job.providerConversationId,
        workflowRunId: job.providerWorkflowRunId,
      },
    );
  return createDifyWorkflow(
    config,
    config.bindings.find((item) => item.name === job.binding.name)!,
  );
}
