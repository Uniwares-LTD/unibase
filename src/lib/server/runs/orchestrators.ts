import { domains } from "../domains";
import "server-only";
import { project } from "@/lib/project";
import { parseInput } from "@/lib/input";
import { z } from "zod";
import { AppError } from "@/lib/auth-policy";
import {
  orchestratorSchema,
  type OrchestratorDefinition,
} from "@/lib/contracts/runs";
import { database } from "../mongo";
import { readSettings } from "../settings";
import { fingerprint } from "../ai/jobs";
import { executionKey } from "./credentials";
import {
  difyAppCatalog,
  reconcileOrchestratorAvailability,
  verifyOrchestratorAvailable,
} from "./orchestrator-lifecycle";

export type OrchestratorRecord = {
  _id: string;
  revision: number;
  definition: OrchestratorDefinition;
  validated: boolean;
  updatedAt: Date;
  lifecycle?: "unregistered";
  availability?: "missing";
  admissionSequence?: number;
};
export async function seedOrchestrators() {
  const raw = z
    .array(orchestratorSchema)
    .max(100)
    .parse(JSON.parse(process.env.DIFY_ORCHESTRATORS_JSON || "[]"));
  if (process.env.DIFY_MODE === "fake" && project.examples && !raw.length)
    raw.push({
      id: "demo",
      name: "Demo orchestrator",
      description: "Local structured UI and durable run fixture.",
      order: 0,
      keyEnv: "DIFY_KEY_DEMO",
      enabled: true,
      inputs: [
        {
          name: "prompt",
          label: "What would you like to create?",
          kind: "paragraph",
          required: true,
          options: [],
        },
      ],
      pricing: null,
      recovery: { version: "1", stages: ["draft"], diagnostic: true },
    });
  for (const definition of raw)
    await database()
      .collection<OrchestratorRecord>("orchestrators")
      .updateOne(
        { _id: definition.id },
        {
          $setOnInsert: {
            revision: 0,
            definition,
            validated: process.env.DIFY_MODE === "fake",
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
}
export async function orchestrators(
  admin = false,
  refreshAvailability = false,
) {
  await seedOrchestrators();
  if (
    refreshAvailability &&
    process.env.DIFY_MODE === "live" &&
    process.env.DIFY_MANAGEMENT_KEY &&
    process.env.DIFY_CONSOLE_URL
  ) {
    try {
      const observationStarted = new Date();
      await reconcileOrchestratorAvailability(
        await difyAppCatalog(),
        database(),
        observationStarted,
      );
    } catch {
      /* Outages are not evidence of deletion; admission verifies again. */
    }
  }
  const settings = await readSettings();
  const rows = await database()
    .collection<OrchestratorRecord>("orchestrators")
    .find(
      admin
        ? { lifecycle: { $ne: "unregistered" } }
        : {
            "definition.enabled": true,
            validated: true,
            lifecycle: { $ne: "unregistered" },
            availability: { $ne: "missing" },
          },
    )
    .sort({ "definition.order": 1, _id: 1 })
    .limit(100)
    .toArray();
  return Promise.all(
    rows.map(async (row) => {
      const d = row.definition;
      let hasKey = false;
      try {
        hasKey = !!(await executionKey(d));
      } catch {
        /* Report unavailable credentials without exposing them. */
      }
      const ready =
        row.availability !== "missing" &&
        (process.env.DIFY_MODE === "fake" || (hasKey && !!d.workflowId));
      const configurationKey = fingerprint([
        row.revision,
        settings.revision,
        d,
      ]);
      return admin
        ? {
            ...d,
            revision: row.revision,
            validated: row.validated,
            ready,
            setupIssues: [
              ...(row.availability === "missing"
                ? ["Workflow is no longer available in Dify."]
                : []),
              ...(process.env.DIFY_MODE === "fake"
                ? []
                : [
                    ...(!hasKey
                      ? [
                          d.credentialId
                            ? "The saved app key is unavailable. Reconnect the app."
                            : `Execution key ${d.keyEnv} is not configured on the server. Connect the app automatically or configure this variable.`,
                        ]
                      : []),
                    ...(!d.workflowId
                      ? ["Published workflow version is missing."]
                      : []),
                    ...(process.env.DIFY_MODE !== "live"
                      ? ["Dify execution is disabled in server configuration."]
                      : []),
                    ...(!process.env.DIFY_BASE_URL
                      ? ["Dify execution URL is not configured."]
                      : []),
                  ]),
              ...(!row.validated
                ? ["Connection and inputs need validation."]
                : []),
              ...(!settings.settings.runs.enabled
                ? ["Runs are disabled in Base settings."]
                : []),
            ],
            configurationKey,
          }
        : {
            id: d.id,
            name: d.name,
            description: d.description,
            inputs: d.inputs,
            pricing: d.pricing ?? settings.settings.runs.pricing,
            failureCharging:
              d.failureCharging ?? settings.settings.runs.failureCharging,
            configurationKey,
            ready: ready && settings.settings.runs.enabled,
            recovery: d.recovery,
            requiresArtifact:
              d.domainAdapter?.id === "artifact" ||
              (d.privateTools?.some((t) => t.includes("artifact")) ?? false),
            domainTarget: d.domainAdapter
              ? (() => {
                  const adapter = domains.get(
                    d.domainAdapter.id,
                    d.domainAdapter.version,
                  );
                  return { kind: adapter.kind, ...adapter.picker };
                })()
              : null,
          };
    }),
  );
}
export async function selectedOrchestrator(id: string) {
  parseInput(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), id);
  await seedOrchestrators();
  const row = await database()
    .collection<OrchestratorRecord>("orchestrators")
    .findOne({ _id: id });
  if (
    !row ||
    !row.validated ||
    !row.definition.enabled ||
    row.lifecycle === "unregistered" ||
    row.availability === "missing"
  )
    throw new AppError(
      "ORCHESTRATOR_UNAVAILABLE",
      "This orchestrator is unavailable.",
      409,
    );
  await verifyOrchestratorAvailable(row);
  return row;
}
