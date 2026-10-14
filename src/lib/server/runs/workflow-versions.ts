import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  workflowVersionsSchema,
  workflowVersionSelectionSchema,
  type WorkflowVersionSelection,
} from "@/lib/contracts/workflow-versions";
import { difyJson } from "./dify-console-client";

export const workflowPublicationSchema = z.object({
  id: z.string().uuid(),
  version: z.string().min(1).max(100),
  version_number: z.number().int().positive().nullish(),
  marked_name: z.string().max(200).nullish(),
  created_at: z.number().int().nonnegative(),
  graph: z.json(),
  hash: z.string().optional(),
  features: z.json().optional(),
  environment_variables: z.json().optional(),
  conversation_variables: z.json().optional(),
});

// Dify 1.17.1 includes draft rows and full graphs in this paginated response.
// Read one bounded page; never expose those graphs or private variables to clients.
async function workflowPage(
  appId: string,
  page: number,
  request: typeof difyJson,
) {
  appId = z.string().uuid().parse(appId).toLowerCase();
  page = workflowVersionSelectionSchema.shape.page.parse(page);
  const result = z
    .object({
      items: z.array(workflowPublicationSchema).max(10),
      page: z.literal(page),
      has_more: z.boolean(),
    })
    .parse(
      await request(`/apps/${appId}/workflows?page=${page}&limit=10`, {
        management: true,
      }),
    );
  return {
    ...result,
    items: result.items.filter((row) => row.version !== "draft"),
  };
}

export async function difyWorkflowVersions(
  appId: string,
  page = 1,
  request: typeof difyJson = difyJson,
) {
  const result = await workflowPage(appId, page, request);
  return workflowVersionsSchema.parse({
    versions: result.items.map((row) => ({
      id: row.id,
      name: row.marked_name ?? "",
      version: row.version,
      number: row.version_number ?? null,
      createdAt: row.created_at,
    })),
    page: result.page,
    hasMore: result.has_more,
  });
}

export async function selectedWorkflowVersion(
  appId: string,
  selection: WorkflowVersionSelection,
  request: typeof difyJson = difyJson,
) {
  selection = workflowVersionSelectionSchema.parse(selection);
  const result = await workflowPage(appId, selection.page, request);
  const workflow = result.items.find((row) => row.id === selection.workflowId);
  if (!workflow)
    throw new AppError(
      "DIFY_VERSION_UNAVAILABLE",
      "The selected workflow version is no longer on this page. Reload versions and choose again.",
      409,
    );
  return workflow;
}
