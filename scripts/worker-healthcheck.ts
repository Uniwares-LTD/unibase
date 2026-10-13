import { requiredWorkers } from "../src/lib/project";
import { checkWorkerHeartbeat } from "../src/lib/server/worker-heartbeat";
const kind = process.argv[2];
if (kind !== "payment" && kind !== "ai") process.exitCode = 1;
else if (requiredWorkers.includes(kind))
  void checkWorkerHeartbeat(kind).catch(() => {
    process.exitCode = 1;
  });
