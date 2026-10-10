import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { currentCreditAccount } from "@/lib/server/credits";
import { requireSession } from "@/lib/server/session";
import {
  publicCatalog,
  currentSimulatedPurchases,
} from "@/lib/server/purchases";
import { CreditSummary } from "@/components/credit-summary";
import { PurchaseSimulator } from "@/components/purchase-simulator";
import { CreditCheckout } from "@/components/credit-checkout";

export const metadata: Metadata = { title: "Credits" };
export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const { before } = await searchParams;
  const cursor = before === undefined ? undefined : Number(before);
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
    redirect("/credits");
  const session = await requireSession().catch((error: unknown) => {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      redirect("/account");
    throw error;
  });
  const account = await currentCreditAccount(cursor);
  const catalog = publicCatalog();
  const orders =
    catalog.mode === "simulation" ? await currentSimulatedPurchases() : [];
  return (
    <div className="page-stack">
      <PageHeader
        title="Credits"
        description="Your balance and credit history. Purchased credits never expire; promotional grants may have an expiry date."
      />
      <CreditSummary account={account} historyPath="/credits" />
      {catalog.mode === "simulation" ? (
        <PurchaseSimulator
          key={session.uid}
          uid={session.uid}
          initialKey={randomUUID()}
          packs={catalog.packs}
          orders={orders}
        />
      ) : catalog.mode === "stripe" ? (
        <CreditCheckout
          key={session.uid}
          uid={session.uid}
          initialKey={randomUUID()}
          packs={catalog.packs}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Credit purchases are not available yet.
        </p>
      )}
    </div>
  );
}
