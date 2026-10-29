import { grantRevokeSchema } from "@/lib/contracts/diagnostics";
import { endpoint, json, readJson } from "@/lib/server/http";
import {
  currentGrants,
  issueGrant,
  withdrawGrant,
} from "@/lib/server/diagnostics/service";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// endpoint() applies session, origin/CSRF and request limits; the service
// enforces administrator role and recent login for changes.
export async function GET(request: Request) {
  return endpoint(request, async () => json(await currentGrants()));
}
export async function POST(request: Request) {
  return endpoint(request, async () =>
    json(await issueGrant(await readJson(request, z.unknown(), 4096)), 201),
  );
}
export async function DELETE(request: Request) {
  return endpoint(request, async () => {
    const { id } = await readJson(request, grantRevokeSchema, 1024);
    return json(await withdrawGrant(id));
  });
}
