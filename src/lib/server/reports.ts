import "server-only";
import { requireAdmin } from "./admin";
import { database } from "./mongo";
import { readDashboard, readReports } from "./store/reports";
export async function administratorReports(input: unknown) {
  const actor = await requireAdmin();
  return readReports(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    input,
  );
}
export async function administratorDashboard() {
  const actor = await requireAdmin();
  return readDashboard(database(), {
    uid: actor.uid,
    authTime: actor.auth_time,
  });
}
