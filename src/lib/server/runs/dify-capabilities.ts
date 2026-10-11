import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  difyInitialInputs,
  orchestratorSchema,
  parseUiForm,
} from "@/lib/contracts/runs";
import type { difyJson } from "./dify-console-client";

const graphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string(),
        data: z.looseObject({ type: z.string() }),
      }),
    )
    .min(2)
    .max(1000),
});
type McpTool = { providerId: string; toolName: string };

// Inspect the publication only. Drafts, node bindings and provider secrets stay
// in Dify; neither this module nor registration changes the graph.
export function inspectDifyWorkflow(graph: unknown) {
  const { nodes } = graphSchema.parse(graph);
  const starts = nodes.filter((node) => node.data.type === "start");
  if (starts.length !== 1 || !nodes.some((node) => node.data.type === "end"))
    throw new AppError(
      "DIFY_WORKFLOW_UNSUPPORTED",
      "Choose a published Workflow with a Start and End node.",
      409,
    );
  const fields = z
    .array(z.looseObject({ variable: z.string(), type: z.string() }))
    .max(100)
    .parse(starts[0].data.variables ?? []);
  const legacyInputs = orchestratorSchema.shape.legacyInputs.parse(
    fields
      .filter((field) =>
        ["unibase_run_id", "unibase_attempt_id", "unibase_recovery"].includes(
          field.variable,
        ),
      )
      .map((field) => field.variable),
  )!;
  if (
    fields.some(
      (field) =>
        field.variable.startsWith("unibase_") &&
        field.required === true &&
        !legacyInputs.includes(field.variable as (typeof legacyInputs)[number]),
    )
  )
    throw new AppError(
      "DIFY_INPUT_UNSUPPORTED",
      "The workflow has an unknown required Unibase input.",
      409,
    );
  let inputs;
  try {
    inputs = orchestratorSchema.shape.inputs.parse(
      difyInitialInputs({
        user_input_form: fields
          .filter((field) => !field.variable.startsWith("unibase_"))
          .map((field) => ({
            [field.type]: {
              ...field,
              label:
                typeof field.label === "string" ? field.label : field.variable,
            },
          })),
      }),
    );
  } catch {
    throw new AppError(
      "DIFY_INPUT_UNSUPPORTED",
      "The workflow uses unsupported Start controls. Use text, paragraph, number, select or single-file inputs.",
      409,
    );
  }
  const mcpTools: McpTool[] = [];
  for (const { data } of nodes) {
    if (data.type === "human-input") {
      const form = z
        .object({
          delivery_methods: z.array(
            z.object({ type: z.string(), enabled: z.boolean() }),
          ),
          form_content: z.string().max(100000),
          inputs: z
            .array(
              z.object({
                type: z.enum(["paragraph", "select", "file", "file-list"]),
                output_variable_name: z.string().min(1).max(64),
              }),
            )
            .max(20),
          user_actions: z
            .array(
              z.object({
                id: z.string().min(1).max(20),
                title: z.string().min(1).max(100),
              }),
            )
            .min(1)
            .max(20),
        })
        .safeParse(data);
      if (
        !form.success ||
        !form.data.delivery_methods.some(
          (method) => method.type === "webapp" && method.enabled,
        )
      )
        throw new AppError(
          "DIFY_HUMAN_INPUT_UNSUPPORTED",
          "Human Input needs WebApp delivery, supported fields and at least one action in Dify.",
          409,
        );
      if (form.data.form_content.includes("```unibase-ui")) {
        try {
          if (
            !form.data.form_content.includes("{{#$output.response#}}") ||
            form.data.inputs.length !== 1 ||
            form.data.inputs[0].type !== "paragraph" ||
            form.data.inputs[0].output_variable_name !== "response"
          )
            throw new Error();
          // Dynamic content is validated after Dify renders it. Literal cards can
          // be checked now without invoking a model or asking a human to act.
          if (
            !/\{\{#[^}]+#\}\}/.test(
              form.data.form_content.replace("{{#$output.response#}}", ""),
            )
          )
            parseUiForm(form.data.form_content);
        } catch {
          throw new AppError(
            "DIFY_GENERATIVE_UI_UNSUPPORTED",
            "The Human Input node has an invalid Generative UI response contract.",
            409,
          );
        }
      }
    }
    if (data.type === "tool" && data.provider_type === "mcp") {
      const tool = z
        .object({
          provider_id: z.string().min(1).max(128),
          tool_name: z.string().min(1).max(128),
        })
        .parse(data);
      mcpTools.push({ providerId: tool.provider_id, toolName: tool.tool_name });
    }
  }
  if (new Set(mcpTools.map((tool) => tool.providerId)).size > 20)
    throw new AppError(
      "DIFY_MCP_UNSUPPORTED",
      "This workflow references too many MCP providers.",
      409,
    );
  return { inputs, legacyInputs, mcpTools };
}

export async function verifyMcpTools(
  tools: McpTool[],
  request: typeof difyJson,
) {
  if (!tools.length) return;
  // Workflow nodes use server identifiers, whereas the detail endpoint expects
  // database UUIDs. The read-only catalog exposes the same identifiers as nodes.
  const providers = z
    .array(
      z.object({
        id: z.string(),
        is_team_authorization: z.boolean(),
        tools: z.array(z.object({ name: z.string() })).max(1000),
      }),
    )
    .max(1000)
    .parse(
      await request("/workspaces/current/tools/mcp", { management: true }),
    );
  for (const providerId of new Set(tools.map((tool) => tool.providerId))) {
    const provider = providers.find((p) => p.id === providerId);
    if (
      !provider ||
      !provider.is_team_authorization ||
      tools
        .filter((tool) => tool.providerId === providerId)
        .some(
          (tool) =>
            !provider.tools.some(
              (available) => available.name === tool.toolName,
            ),
        )
    )
      throw new AppError(
        "DIFY_MCP_UNAVAILABLE",
        "Connect the referenced MCP provider and synchronize its tools in Dify before registering.",
        409,
      );
  }
}
