import { PageMessages } from "@/components/page-messages";

import type { Metadata } from "next";
import { PageHeader } from "@/components/page-patterns";
import Link from "next/link";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getManagedUser } from "@/lib/server/admin";
import { adminPageSession } from "@/lib/server/admin-view";
import { AdminUserControls } from "@/components/admin-user-controls";
import { AdminCreditControls } from "@/components/admin-credit-controls";
import { CreditSummary } from "@/components/credit-summary";
import { managedCreditAccount } from "@/lib/server/credits";
import { randomUUID } from "node:crypto";

const managedUser = cache((uid: string) => getManagedUser(uid));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uid: string }>;
}): Promise<Metadata> {
  const user = await managedUser((await params).uid).catch(() => null);
  return {
    title: user?.displayName || user?.email || "Manage account",
  };
}
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { uid } = await params;
  const actor = await adminPageSession();
  const user = await managedUser(uid);
  if (!user) notFound();
  const { before } = await searchParams;
  const cursor = before === undefined ? undefined : Number(before);
  const historyPath = `/admin/users/${encodeURIComponent(uid)}`;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))
    redirect(historyPath);
  const account = await managedCreditAccount(uid, cursor);
  return (
    <PageMessages path="/admin/users/[uid]">
      <div className="max-w-3xl page-stack">
        <Button variant="ghost" asChild className="-ms-3 w-fit">
          <Link href="/admin/users">
            <ArrowLeft aria-hidden="true" className="rtl:rotate-180" />
            All users
          </Link>
        </Button>
        <PageHeader
          title={user.displayName || user.email || "Manage account"}
          description="Review this account's access, profile and credits."
        />
        <div className="break-all">
          <p>{user.email || "No email"}</p>
          <p className="text-sm text-muted-foreground">
            <bdi>{user.uid}</bdi>
          </p>
        </div>
        <AdminUserControls user={user} actorUid={actor.uid} />
        <CreditSummary
          account={account}
          historyPath={historyPath}
          paged={cursor !== undefined}
        />
        <AdminCreditControls
          uid={uid}
          actorUid={actor.uid}
          initialKey={randomUUID()}
        />
      </div>
    </PageMessages>
  );
}
