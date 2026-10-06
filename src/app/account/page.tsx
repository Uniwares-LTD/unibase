import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { ProfileForm } from "@/components/profile-form";
import { SessionControls } from "@/components/session-controls";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthConfig } from "@/lib/server/auth-config";
import { getSession } from "@/lib/server/session";
import { getMyProfile } from "@/lib/server/profiles";
import { accountAccess } from "@/lib/server/store/access";
import { database } from "@/lib/server/mongo";
import { Button } from "@/components/ui/button";
export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await getSession();
  const profile = session?.email_verified ? await getMyProfile() : null;
  const isAdmin =
    !!profile &&
    (await accountAccess(database(), profile.uid)).role === "admin";
  return (
    <div className="max-w-2xl page-stack">
      <PageHeader
        title="Account"
        description="Your profile, sign-in, and preferences."
      />
      <Card>
        <CardContent className="space-y-6 py-6">
          {profile ? (
            <ProfileForm key={profile.uid} profile={profile} />
          ) : (
            <AuthForm config={getAuthConfig().public} />
          )}
          {session && <SessionControls />}
        </CardContent>
      </Card>
      <div className="flex flex-wrap gap-3">
        {profile && (
          <Button variant="outline" asChild>
            <Link href="/credits">Credits</Link>
          </Button>
        )}
        {isAdmin && (
          <Button variant="outline" asChild>
            <Link href="/admin">Administration</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
