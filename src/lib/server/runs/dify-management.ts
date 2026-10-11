import type { Document } from "mongodb";
import "server-only";
import { difyJson } from "./dify-console-client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  difyInitialInputs,
  orchestratorSchema,
  orchestratorUpdateSchema,
} from "@/lib/contracts/runs";
import { requireAdmin } from "../admin";
import { database } from "../mongo";
import { fingerprint } from "../ai/jobs";
import { accessTransaction } from "../store/access";
import { saveOrchestrator } from "./orchestrators";

export const managementCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("discover") }),
  z.strictObject({
    action: z.literal("metadata"),
    definition: orchestratorSchema,
  }),
  z.strictObject({
    action: z.literal("validate"),
    ...orchestratorUpdateSchema.shape,
  }),
  z.strictObject({
    action: z.literal("import"),
    key: z.string().uuid(),
    yaml: z
      .string()
      .min(1)
      .max(512 * 1024),
    name: z.string().min(1).max(100),
    appId: z.string().uuid().optional(),
    confirmOverwrite: z.boolean().default(false),
  }),
  z.strictObject({
    action: z.literal("confirm-import"),
    key: z.string().uuid(),
    importId: z.string().uuid(),
  }),
  z.strictObject({ action: z.literal("export"), appId: z.string().uuid() }),
]);
export async function manageDify(input: unknown) {
  const command = managementCommandSchema.parse(input);
  const actor = await requireAdmin(
    command.action !== "discover" && command.action !== "export",
  );
  if (command.action === "metadata") {
    const d = command.definition;
    const info = z
      .object({
        name: z.string(),
        description: z.string().default(""),
        mode: z.literal("workflow"),
      })
      .parse(await difyJson("/info", { key: process.env[d.keyEnv] }));
    const parameters = z
      .object({
        user_input_form: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .parse(await difyJson("/parameters", { key: process.env[d.keyEnv] }));
    const inputs = difyInitialInputs(parameters).filter(
      (f) => !f.name.startsWith("unibase_"),
    );
    let workflowId = d.workflowId;
    if (d.appId && process.env.DIFY_MANAGEMENT_KEY) {
      const published = z.object({ id: z.string().uuid() }).parse(
        await difyJson(`/apps/${d.appId}/workflows/publish`, {
          management: true,
        }),
      );
      workflowId = published.id;
    }
    return {
      definition: orchestratorSchema.parse({
        ...d,
        name: info.name,
        description: info.description,
        inputs,
        workflowId,
      }),
    };
  }
  if (command.action === "validate") {
    const d = orchestratorSchema.parse(command.definition);
    if (process.env.DIFY_MODE !== "fake") {
      if (!d.workflowId)
        throw new AppError(
          "WORKFLOW_VERSION_REQUIRED",
          "Select a published workflow version.",
        );
      const info = z
        .object({ mode: z.literal("workflow") })
        .parse(await difyJson("/info", { key: process.env[d.keyEnv] }));
      void info;
      const parameters = z
        .object({
          user_input_form: z
            .array(z.record(z.string(), z.unknown()))
            .default([]),
        })
        .parse(await difyJson("/parameters", { key: process.env[d.keyEnv] }));
      const providerInputs = difyInitialInputs(parameters);
      const names = providerInputs.map((f) => f.name);
      const matches =
        d.inputs.every((field) => {
          const offered = providerInputs.find((f) => f.name === field.name);
          return (
            offered &&
            offered.kind === field.kind &&
            offered.required === field.required &&
            (field.kind !== "select" ||
              fingerprint(offered.options) === fingerprint(field.options))
          );
        }) &&
        providerInputs.every(
          (f) =>
            f.name.startsWith("unibase_") ||
            !f.required ||
            d.inputs.some((i) => i.name === f.name),
        );
      if (!matches)
        throw new AppError(
          "INPUT_CONTRACT_MISMATCH",
          "Configured controls do not match Dify parameters.",
        );
      if (d.recovery && !names.includes("unibase_recovery"))
        throw new AppError(
          "INPUT_CONTRACT_MISMATCH",
          "Recovery requires the unibase_recovery input.",
        );
      // Correlation fields are part of the versioned orchestrator contract.
      if (
        !names.includes("unibase_run_id") ||
        !names.includes("unibase_attempt_id")
      )
        throw new AppError(
          "INPUT_CONTRACT_MISMATCH",
          "Dify must accept application run and attempt IDs.",
        );
    }
    if (
      d.appId &&
      process.env.DIFY_MANAGEMENT_KEY &&
      process.env.DIFY_MODE !== "fake"
    ) {
      const published = z
        .object({
          id: z.string().uuid(),
          graph: z.object({
            nodes: z.array(
              z.object({
                data: z.object({
                  type: z.string(),
                  outputs: z
                    .array(z.object({ variable: z.string() }))
                    .optional(),
                }),
              }),
            ),
          }),
        })
        .parse(
          await difyJson(`/apps/${d.appId}/workflows/publish`, {
            management: true,
          }),
        );
      if (
        published.id !== d.workflowId ||
        !published.graph.nodes.some(
          (n) =>
            n.data.type === "end" &&
            n.data.outputs?.some((o) => o.variable === "result"),
        )
      )
        throw new AppError(
          "OUTPUT_CONTRACT_MISMATCH",
          "Select the current published workflow with a result output.",
        );
    }
    return saveOrchestrator(command, true);
  }
  if (command.action === "discover") {
    const rows: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = z
        .object({
          data: z.array(
            z.object({
              id: z.string().uuid(),
              name: z.string(),
              mode: z.string(),
              description: z.string().optional(),
            }),
          ),
          has_more: z.boolean().optional(),
        })
        .parse(
          await difyJson(`/apps?page=${page}&limit=100`, { management: true }),
        );
      rows.push(...result.data);
      if (!result.has_more) break;
    }
    return { apps: rows };
  }
  if (command.action === "export") {
    const result = z.object({ data: z.string().max(512 * 1024) }).parse(
      await difyJson(`/apps/${command.appId}/export?include_secret=false`, {
        management: true,
      }),
    );
    return { yaml: result.data };
  }
  if (command.action === "import" && command.appId && !command.confirmOverwrite)
    throw new AppError(
      "OVERWRITE_CONFIRMATION",
      "Confirm the selected overwrite target.",
      409,
    );
  const operations = database().collection<{
    _id: string;
    hash: string;
    status: string;
    result?: unknown;
  }>("difyManagementOperations");
  const id = fingerprint([actor.uid, command.key]);
  const hash = fingerprint(command);
  const prior = await operations.findOne({ _id: id });
  if (prior) {
    if (prior.hash !== hash)
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        "Request key was already used.",
        409,
      );
    if (prior.status === "completed") return prior.result;
    throw new AppError(
      "DIFY_OUTCOME_UNKNOWN",
      "This import needs inspection in Dify before another attempt.",
      409,
    );
  }
  await accessTransaction(
    database(),
    actor.uid,
    async (session) => {
      await operations.insertOne(
        { _id: id, hash, status: "pending" },
        { session },
      );
      await database()
        .collection<Document & { _id: string }>("auditEvents")
        .insertOne(
          {
            _id: randomUUID(),
            event: "dify-management-intent",
            actorUid: actor.uid,
            targetUid: actor.uid,
            reason: command.action,
            timestamp: new Date(),
          },
          { session },
        );
    },
    actor.auth_time,
  );
  const result =
    command.action === "import"
      ? await difyJson("/apps/imports", {
          management: true,
          body: {
            mode: "yaml-content",
            yaml_content: command.yaml,
            name: command.name,
            ...(command.appId ? { app_id: command.appId } : {}),
          },
        })
      : await difyJson(`/apps/imports/${command.importId}/confirm`, {
          management: true,
          body: {},
        });
  const safe = z
    .object({
      id: z.string().optional(),
      app_id: z.string().nullable().optional(),
      status: z.string(),
      error: z.string().nullable().optional(),
      warnings: z.array(z.unknown()).max(100).default([]),
    })
    .parse(result);
  const view = {
    id: safe.id,
    app_id: safe.app_id,
    status: safe.status,
    warnings: safe.warnings.map(
      () =>
        "Dify reported a dependency or compatibility warning. Inspect it in Dify before publishing.",
    ),
    error: safe.error
      ? "Dify import reported an error. Inspect dependencies in Dify."
      : null,
  };
  await operations.updateOne(
    { _id: id },
    { $set: { status: "completed", result: view } },
  );
  return view;
}
