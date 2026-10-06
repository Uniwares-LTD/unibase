import type { Metadata } from "next";
import { PageHeader } from "@/components/page-patterns";
import { notFound } from "next/navigation";
import { getManagedUser } from "@/lib/server/admin";
import { adminPageSession } from "@/lib/server/admin-view";
import { AdminUserControls } from "@/components/admin-user-controls";
import { AdminCreditControls } from "@/components/admin-credit-controls";
import { CreditSummary } from "@/components/credit-summary";
import { managedCreditAccount } from "@/lib/server/credits";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Manage account" };
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { uid } = await params;
  const actor = await adminPageSession();
  const user = await getManagedUser(uid);
  if (!user) notFound();
  const { before } = await searchParams;
  const cursor = before === undefined ? undefined : Number(before);
  const historyPath = `/admin/users/${encodeURIComponent(uid)}`;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
    redirect(historyPath);
  const account = await managedCreditAccount(uid, cursor);
  return (
    <div className="max-w-2xl page-stack">
      <PageHeader
        title="Manage account"
        description="Review this account's access, profile and credits."
      />
      <div className="break-all">
        <p>{user.email || "No email"}</p>
        <p className="text-sm text-muted-foreground">{user.uid}</p>
      </div>
      <AdminUserControls user={user} actorUid={actor.uid} />
      <CreditSummary account={account} historyPath={historyPath} />
      <AdminCreditControls
        uid={uid}
        actorUid={actor.uid}
        initialKey={randomUUID()}
      />
    </div>
  );
}
