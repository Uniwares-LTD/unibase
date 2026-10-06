import "server-only";
import { database } from "./mongo";
import { requireSession } from "./session";
import {
  finishReservation,
  readWallet,
  reserveCredits,
  readCreditAccount,
  adjustCredits,
} from "./store/credits";
import { requireAdmin } from "./admin";
import { adminAuth } from "./firebase";
import { adjustmentSchema } from "../contracts/credits";
import { AppError } from "../auth-policy";

async function currentActor() {
  const session = await requireSession();
  return { uid: session.uid, authTime: session.auth_time };
}

export async function currentWallet() {
  const actor = await currentActor();
  return readWallet(database(), actor.uid, { actor });
}

export async function currentCreditAccount(before?: number) {
  const actor = await currentActor();
  return readCreditAccount(database(), actor.uid, before, { actor });
}

export async function managedCreditAccount(uid: string, before?: number) {
  const session = await requireAdmin();
  await adminAuth().getUser(uid);
  return readCreditAccount(database(), uid, before, {
    admin: { uid: session.uid, authTime: session.auth_time },
  });
}

export async function adjustManagedCredits(input: unknown) {
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "INVALID_INPUT",
      "Enter a whole positive amount, a valid expiry and a reason.",
    );
  const actor = await requireAdmin(true);
  await adminAuth().getUser(parsed.data.targetUid);
  return adjustCredits(
    database(),
    { uid: actor.uid, authTime: actor.auth_time },
    parsed.data.targetUid,
    parsed.data.key,
    parsed.data,
  );
}

// These are server-module interfaces for a future priced product operation, not
// Server Actions or HTTP endpoints. Its server code supplies the quantity and key.
export async function reserveCurrentCredits(key: string, amount: number) {
  return reserveCredits(database(), await currentActor(), key, amount);
}

export async function commitCurrentCredits(key: string, reservationId: string) {
  return finishReservation(
    database(),
    await currentActor(),
    key,
    reservationId,
    "commit",
  );
}

export async function releaseCurrentCredits(
  key: string,
  reservationId: string,
) {
  return finishReservation(
    database(),
    await currentActor(),
    key,
    reservationId,
    "release",
  );
}
