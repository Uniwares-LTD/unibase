import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
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
    title:
      user?.displayName ||
      user?.email ||
      (await getTranslations("ui"))("mddb585602c09"),
  };
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
            {translate("m82545b8b2f36")}
          </Link>
        </Button>
        <PageHeader
          title={user.displayName || user.email || translate("mddb585602c09")}
          description={translate("m9a1945b0e48e")}
        />
        <div className="break-all">
          <p>{user.email || translate("m2f44d9d0a44f")}</p>
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
