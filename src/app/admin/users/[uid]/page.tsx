import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
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

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("mddb585602c09") };
}
export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ uid: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const translate = await getTranslations("ui");

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
    <PageMessages path="/admin/users/[uid]">
      {
        <div className="max-w-2xl page-stack">
          <PageHeader
            title={translate("mddb585602c09")}
            description={translate("m9a1945b0e48e")}
          />
          <div className="break-all">
            <p>{user.email || translate("m2f44d9d0a44f")}</p>
            <p className="text-sm text-muted-foreground">
              <bdi>{user.uid}</bdi>
            </p>
          </div>
          <AdminUserControls user={user} actorUid={actor.uid} />
          <CreditSummary account={account} historyPath={historyPath} />
          <AdminCreditControls
            uid={uid}
            actorUid={actor.uid}
            initialKey={randomUUID()}
          />
        </div>
      }
    </PageMessages>
  );
}
