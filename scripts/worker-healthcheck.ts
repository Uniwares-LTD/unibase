import { checkWorkerHeartbeat } from "../src/lib/server/worker-heartbeat";
const kind = process.argv[2];
if (kind !== "payment" && kind !== "ai") process.exitCode = 1;
else
  void checkWorkerHeartbeat(kind).catch(() => {
    process.exitCode = 1;
  });
