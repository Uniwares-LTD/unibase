import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { setTimeout as delay } from "node:timers/promises";
import { parseConfig } from "../src/lib/config/schema";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { readSettings } from "../src/lib/server/settings";
import { providerForRun, tracingForRun } from "../src/lib/server/runs/provider";
import { prepareRunInputs } from "../src/lib/server/runs/service";
import { prepareResult, attachResult } from "../src/lib/server/runs/media";
import { parseResult } from "../src/lib/contracts/runs";
import { processOneAiJob } from "../src/lib/server/ai/worker";
import { authorizeWorkerAccount as authorizeAccount } from "../src/lib/server/worker-authorization";
import { runtimeRecord } from "../src/lib/log-policy";
import { writeRuntimeRecord } from "../src/lib/server/store/runtime";
import { workerHeartbeat } from "../src/lib/server/worker-heartbeat";

import {
  processOneAutomaticDecision,
  responderAnswer,
} from "../src/lib/server/runs/responder";
import { processOneResultApplication } from "../src/lib/server/domain-results";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
let stopping = false;
const idle = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    idle.abort();
  });

async function main() {
  const mode = process.env.DIFY_MODE ?? "disabled";
  const base = parseConfig(process.env);
  const databaseConfig = parseDatabaseConfig(
    process.env,
    base.server.environment,
  );
  const client = new MongoClient(databaseConfig.mongoUri, {
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  const db = client.db(databaseConfig.database);
  const heartbeat = workerHeartbeat(db, "ai");
  try {
    await heartbeat(mode === "disabled" ? "disabled" : "ok");
    do {
      let cycleState: "ok" | "error" | "disabled" =
        mode === "disabled" ? "disabled" : "ok";
      if (mode !== "disabled") {
        const started = performance.now();
        let status = 200;
        let worked = false;
        try {
          await readSettings(db);
          const executed = await processOneAiJob(db, {
            provider: (job) => providerForRun(job, db),
            trace: tracingForRun,
            prepareInput: (job) =>
              job.responder
                ? Promise.resolve(job.inputs)
                : prepareRunInputs(job, db),
            materialize: (job, result, session) =>
              attachResult(db, job, session),
            authorize: authorizeAccount,
            validateOutput: (job, result) => {
              try {
                if (job.responder) responderAnswer(job, result.outputs);
                else parseResult(result.outputs);
                return true;
              } catch {
                return false;
              }
            },
            terminalOutput: async (job, result) => {
              if (result.status === "failed" || result.status === "stopped") {
                if (result.outputs?.result)
                  await prepareResult(db, job, result);
                return "failed";
              }
              await prepareResult(db, job, result);
              return parseResult(result.outputs).outcome === "success" &&
                result.status === "succeeded"
                ? "succeeded"
                : "failed";
            },
          });
          worked = executed;
          worked = (await processOneAutomaticDecision(db)) || worked;
          worked = (await processOneResultApplication(db)) || worked;
        } catch {
          status = 503;
          cycleState = "error";
          if (process.argv.includes("--once")) process.exitCode = 1;
        }
        if (worked || status !== 200) {
          const record = runtimeRecord("ai-maintenance", {
            status,
            durationMs: performance.now() - started,
            requestId: crypto.randomUUID(),
          });
          console.log(JSON.stringify(record));
          await writeRuntimeRecord(db, record, 500).catch(() => undefined);
        }
      }
      await heartbeat(cycleState).catch(() => undefined);
      if (process.argv.includes("--once")) break;
      await delay(2000, undefined, { signal: idle.signal }).catch(
        () => undefined,
      );
    } while (!stopping);
  } finally {
    await client.close();
  }
}
void main().catch(() => {
  console.error('{"event":"ai-worker-startup","severity":"error"}');
  process.exitCode = 1;
});
