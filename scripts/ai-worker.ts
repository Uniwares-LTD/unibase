import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { setTimeout as delay } from "node:timers/promises";
import { parseConfig } from "../src/lib/config/schema";
import { parseDatabaseConfig } from "../src/lib/config/database";
import { parseAiPricing } from "../src/lib/config/ai-pricing";
import {
  aiConfig,
  capability,
  providerForJob,
  prepareAiInputs,
  materializeAiResult,
} from "../src/lib/server/ai/capabilities";
import { processOneAiJob } from "../src/lib/server/ai/worker";
import { adminAuth } from "../src/lib/server/firebase";
import { runtimeRecord } from "../src/lib/log-policy";
import { writeRuntimeRecord } from "../src/lib/server/store/runtime";
import { workerHeartbeat } from "../src/lib/server/worker-heartbeat";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
let stopping = false;
const idle = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    idle.abort();
  });

async function main() {
  const config = aiConfig();
  parseAiPricing(process.env);
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
    await heartbeat(config.mode === "disabled" ? "disabled" : "ok");
    do {
      let cycleState: "ok" | "error" | "disabled" =
        config.mode === "disabled" ? "disabled" : "ok";
      if (config.mode !== "disabled") {
        const started = performance.now();
        let status = 200;
        let worked = false;
        try {
          worked = await processOneAiJob(db, {
            provider: (job) => providerForJob(job, config),
            prepareInput: (job) => prepareAiInputs(db, job),
            materialize: (job, result, session) =>
              materializeAiResult(db, job, result, session),
            authorize: async (uid, authTime) => {
              try {
                const user = await adminAuth().getUser(uid);
                return (
                  !user.disabled &&
                  user.emailVerified &&
                  authTime >=
                    Math.floor(
                      Date.parse(user.tokensValidAfterTime ?? "1970-01-01") /
                        1000,
                    )
                );
              } catch (error) {
                if (
                  typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "auth/user-not-found"
                )
                  return false;
                throw error;
              }
            },
            validateOutput: (job, result) =>
              capability(job.capability, job.capabilityVersion).validOutput(
                result.outputs,
              ),
          });
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
