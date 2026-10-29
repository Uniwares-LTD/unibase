import "server-only";
import type { UserRecord } from "firebase-admin/auth";
import { z } from "zod";
import { AppError } from "../../../auth-policy";
import type { Profile } from "../../../contracts/profile";
import type { AccountAccess } from "../../store/access";
import type {
  CreditLot,
  LedgerEntry,
  Reservation,
  Wallet,
} from "../../store/credit-types";
import type { PaymentOrder } from "../../store/payments";
import {
  before,
  cursorInput,
  define,
  idInput,
  iso,
  PAGE_SIZE,
  paged,
  uidInput,
  type DiagnosticContext,
} from "../context";
import { clean } from "../shape";

const missing = () =>
  new AppError("DIAGNOSTIC_NOT_FOUND", "No matching record.", 404);
const options = (context: DiagnosticContext) => ({
  timeoutMS: context.timeoutMS(),
});

function identity(user: UserRecord) {
  return {
    uid: user.uid,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    providers: user.providerData.map((provider) => provider.providerId),
    createdAt: user.metadata.creationTime ?? null,
    lastSignInAt: user.metadata.lastSignInTime ?? null,
    lastRefreshAt: user.metadata.lastRefreshTime ?? null,
    tokensValidAfter: user.tokensValidAfterTime ?? null,
  };
}
async function account(context: DiagnosticContext, user: UserRecord) {
  const profile = await context.db
    .collection<Profile>("profiles")
    .findOne({ uid: user.uid }, options(context));
  // Read the stored record only; absence means the default member access.
  const access = await context.db
    .collection<AccountAccess>("accountAccess")
    .findOne({ _id: user.uid }, options(context));
  return {
    identity: identity(user),
    profile: profile
      ? {
          displayName: profile.displayName,
          locale: profile.locale ?? null,
          timeZone: profile.timeZone ?? null,
          theme: profile.theme,
          style: profile.style ?? null,
          updatedAt: profile.updatedAt ?? null,
        }
      : null,
    access: access
      ? {
          role: access.role,
          status: access.status,
          notBefore: access.notBefore,
          revision: access.revision,
          updatedAt: iso(access.updatedAt),
        }
      : {
          role: "member",
          status: "active",
          notBefore: 0,
          revision: 0,
          updatedAt: null,
          stored: false,
        },
  };
}

const searchInput = z.union([
  z.strictObject({ email: z.email().max(320) }),
  z.strictObject({ uid: uidInput }),
]);
export const accountSearch = define({
  description: "Exact account lookup by email or Firebase UID.",
  inputs: { email: "exact email, or", uid: "exact Firebase UID" },
  input: searchInput,
  async run(context, input: z.infer<typeof searchInput>) {
    const user =
      "email" in input
        ? await context.identity.getUserByEmail(input.email)
        : await context.identity.getUser(input.uid);
    if (!user) return { rows: [] };
    context.target({ resource: "account", accountUid: user.uid });
    return {
      rows: [
        {
          uid: user.uid,
          email: user.email ?? null,
          emailVerified: user.emailVerified,
          disabled: user.disabled,
        },
      ],
    };
  },
});
const uidOnly = z.strictObject({ uid: uidInput });
export const accountGet = define({
  description:
    "Account identity, verification/provider status, profile, role, suspension and session-revocation metadata.",
  inputs: { uid: "exact Firebase UID" },
  input: uidOnly,
  async run(context, input: z.infer<typeof uidOnly>) {
    const user = await context.identity.getUser(input.uid);
    if (!user) throw missing();
    context.target({ resource: "account", accountUid: user.uid });
    return account(context, user);
  },
});

export const creditsGet = define({
  description:
    "Persisted wallet balance, reservations total, debt and lots. Read-only: expired lots are reported, not settled.",
  inputs: { uid: "exact Firebase UID" },
  input: uidOnly,
  async run(context, input: z.infer<typeof uidOnly>) {
    context.target({ resource: "credits", accountUid: input.uid });
    const wallet = await context.db
      .collection<Wallet>("creditWallets")
      .findOne({ _id: input.uid }, options(context));
    const lots = await context.db
      .collection<CreditLot>("creditLots")
      .find({ uid: input.uid }, options(context))
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const now = context.now.getTime();
    return {
      wallet: wallet
        ? {
            balance: wallet.balance,
            reserved: wallet.reserved,
            available: wallet.balance - wallet.reserved,
            debt: wallet.debt,
            sequence: wallet.sequence,
            revision: wallet.revision,
            updatedAt: iso(wallet.updatedAt),
          }
        : null,
      lots: lots.map((lot) => ({
        id: lot._id,
        source: lot.source,
        reference: lot.reference,
        originalCredits: lot.originalCredits,
        reversedCredits: lot.reversedCredits,
        remaining: lot.remaining,
        reserved: lot.reserved,
        expiresAt: iso(lot.expiresAt),
        expiredPendingSettlement:
          !!lot.expiresAt &&
          lot.expiresAt.getTime() <= now &&
          lot.remaining > 0,
        createdAt: iso(lot.createdAt),
      })),
      lotsTruncated: lots.length === 100,
    };
  },
});

const pagedUid = z.strictObject({ uid: uidInput, cursor: cursorInput });
export const creditsLedger = define({
  description: "Ledger entries for an account, newest first.",
  inputs: { uid: "exact Firebase UID", cursor: "optional nextCursor" },
  input: pagedUid,
  async run(context, input: z.infer<typeof pagedUid>) {
    context.target({ resource: "credits", accountUid: input.uid });
    const criteria = { uid: input.uid };
    const after = context.readCursor(criteria, input.cursor);
    const rows = await context.db
      .collection<LedgerEntry>("creditLedger")
      .find(
        {
          uid: input.uid,
          ...(after ? { sequence: { $lt: Number(after.value) } } : {}),
        },
        options(context),
      )
      .sort({ sequence: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    return paged(
      context,
      criteria,
      rows,
      (row) => ({ value: row.sequence, id: row._id }),
      (row) => ({
        id: row._id,
        sequence: row.sequence,
        kind: row.kind,
        delta: row.delta,
        reservedDelta: row.reservedDelta,
        balanceAfter: row.balanceAfter,
        reservedAfter: row.reservedAfter,
        debtAfter: row.debtAfter,
        reference: row.reference,
        operationId: row.operationId,
        actorUid: row.actorUid ?? null,
        reason: row.reason ?? null,
        timestamp: iso(row.timestamp),
      }),
    );
  },
});
const holdInput = z.strictObject({
  uid: uidInput,
  status: z
    .enum(["active", "committed", "released", "expired", "cancelled"])
    .optional(),
  cursor: cursorInput,
});
export const creditsHolds = define({
  description: "Credit reservations (holds) for an account, newest first.",
  inputs: {
    uid: "exact Firebase UID",
    status: "optional: active, committed, released, expired or cancelled",
    cursor: "optional nextCursor",
  },
  input: holdInput,
  async run(context, input: z.infer<typeof holdInput>) {
    const { cursor, ...criteria } = input;
    context.target({ resource: "credits", accountUid: input.uid });
    const after = context.readCursor(criteria, cursor);
    const rows = await context.db
      .collection<Reservation>("creditReservations")
      .find(
        {
          uid: input.uid,
          ...(input.status ? { status: input.status } : {}),
          ...before("createdAt", after),
        },
        options(context),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    const now = context.now.getTime();
    return paged(
      context,
      criteria,
      rows,
      (row) => ({ value: row.createdAt.toISOString(), id: row._id }),
      (row) => ({
        id: row._id,
        amount: row.amount,
        status: row.status,
        allocations: row.allocations,
        managedJobId: row.managedJobId ?? null,
        committedCredits: row.committedCredits ?? null,
        createdAt: iso(row.createdAt),
        expiresAt: iso(row.expiresAt),
        pastExpiry: row.status === "active" && row.expiresAt.getTime() <= now,
      }),
    );
  },
});

const order = (row: PaymentOrder) => ({
  id: row._id,
  accountUid: row.uid,
  provider: row.provider,
  packId: row.packId,
  label: row.label,
  credits: row.credits,
  amountMinor: row.amountMinor,
  currency: row.currency,
  status: row.status,
  checkoutSessionId: row.sessionId ?? null,
  paymentIntentId: row.paymentIntentId ?? null,
  granted: row.granted,
  reversed: row.reversed,
  revision: row.revision,
  processing: { leased: !!row.leaseToken, leaseUntil: iso(row.leaseUntil) },
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});
const paymentSearchInput = z.strictObject({
  uid: uidInput.optional(),
  status: z
    .enum(["pending", "paid", "expired", "refunded", "disputed"])
    .optional(),
  cursor: cursorInput,
});
export const paymentsSearch = define({
  description: "Stored purchase orders by account and status, newest first.",
  inputs: {
    uid: "optional exact Firebase UID",
    status: "optional: pending, paid, expired, refunded or disputed",
    cursor: "optional nextCursor",
  },
  input: paymentSearchInput,
  async run(context, input: z.infer<typeof paymentSearchInput>) {
    const { cursor, ...criteria } = input;
    if (input.uid)
      context.target({ resource: "payments", accountUid: input.uid });
    const after = context.readCursor(criteria, cursor);
    const rows = await context.db
      .collection<PaymentOrder>("purchaseOrders")
      .find(
        {
          ...(input.uid ? { uid: input.uid } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...before("createdAt", after),
        },
        options(context),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .toArray();
    return paged(
      context,
      criteria,
      rows,
      (row) => ({ value: row.createdAt.toISOString(), id: row._id }),
      order,
    );
  },
});
const idOnly = z.strictObject({ id: idInput });
export const paymentsGet = define({
  description:
    "One purchase order with payment mode, processing state, reviews and reversal evidence. Excludes checkout URLs and raw webhook bodies.",
  inputs: { id: "exact order ID" },
  input: idOnly,
  async run(context, input: z.infer<typeof idOnly>) {
    const row = await context.db
      .collection<PaymentOrder>("purchaseOrders")
      .findOne({ _id: input.id }, options(context));
    if (!row) throw missing();
    context.target({ resource: "payment", id: row._id, accountUid: row.uid });
    const reviews = await context.db
      .collection("paymentReviews")
      .find({ orderId: row._id }, options(context))
      .sort({ createdAt: -1 })
      .limit(25)
      .toArray();
    const objects = [row.sessionId, row.paymentIntentId].filter(
      (value): value is string => !!value,
    );
    const notices = objects.length
      ? await context.db
          .collection("paymentInbox")
          .find(
            { objectId: { $in: objects } },
            {
              ...options(context),
              projection: {
                type: 1,
                objectId: 1,
                status: 1,
                attempts: 1,
                nextAt: 1,
                createdAt: 1,
                completedAt: 1,
              },
            },
          )
          .sort({ createdAt: -1 })
          .limit(25)
          .toArray()
      : [];
    return {
      order: order(row),
      paymentMode: process.env.PAYMENTS_MODE ?? null,
      reversal: { reversedCredits: row.reversed, status: row.status },
      reviews: reviews.map((review) => clean(review)),
      notices: notices.map((notice) => clean(notice)),
    };
  },
});
