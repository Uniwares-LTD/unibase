import { handleDiagnostics } from "@/lib/server/diagnostics/handler";
import { diagnosticsDependencies } from "@/lib/server/diagnostics/service";
import { logOperation } from "@/lib/server/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Operator-authenticated via its own bearer grant, independent of browser
// sessions; no CORS headers are ever returned.
async function handle(request: Request) {
  return handleDiagnostics(request, {
    ...diagnosticsDependencies(),
    log: (status, requestId, started) =>
      logOperation("diagnostics-request", started, status, requestId),
  });
}
export {
  handle as POST,
  handle as GET,
  handle as DELETE,
  handle as PUT,
  handle as PATCH,
  handle as HEAD,
  handle as OPTIONS,
};
