import "server-only";
import { type DiagnosticEvent } from "../diagnostics";
import { runtimeRecord, type RuntimeRecord } from "../log-policy";
import { RuntimeWriter } from "../runtime-writer";
import { database } from "./mongo";
import { writeRuntimeRecord } from "./store/runtime";
import { after } from "next/server";

const globalWriter = globalThis as typeof globalThis & {
  unitaleRuntimeWriter?: RuntimeWriter<RuntimeRecord>;
};
function writer() {
  return (globalWriter.unitaleRuntimeWriter ??=
    new RuntimeWriter<RuntimeRecord>(
      (record, signal, timeoutMS) => {
        signal.throwIfAborted();
        return writeRuntimeRecord(database(), record, timeoutMS);
      },
      () =>
        console.warn(
          JSON.stringify({
            event: "runtime-log-unavailable",
            severity: "warn",
          }),
        ),
    ));
}

export function logOperation(
  event: DiagnosticEvent,
  started: number | undefined,
  status: number,
  requestId = crypto.randomUUID(),
) {
  const record = runtimeRecord(event, {
    status,
    requestId,
    durationMs: started === undefined ? undefined : performance.now() - started,
  });
  try {
    console.log(JSON.stringify(record));
  } catch {
    /* Logging is advisory. */
  }
  const persist = () => writer().enqueue(record);
  try {
    after(async () => {
      await persist();
    });
  } catch {
    void persist();
  } // Operator/worker calls may have no request context.
  return requestId;
}
