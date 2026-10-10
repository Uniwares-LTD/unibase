import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ProfileForm } from "@/components/profile-form";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthConfig } from "@/lib/server/auth-config";
import { getSession } from "@/lib/server/session";
import { getMyProfile } from "@/lib/server/profiles";
export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const session = await getSession();
  const profile = session?.email_verified ? await getMyProfile() : null;
  return (
    <div className="max-w-2xl page-stack">
      <PageHeader
        title="Account"
        description="Your profile and sign-in details."
      />
      <Card>
        <CardContent className="space-y-6 py-6">
          {profile ? (
            <ProfileForm key={profile.uid} profile={profile} />
          ) : (
            <AuthForm config={getAuthConfig().public} />
          )}
        </CardContent>
      </Card>
      <DiagnosticsPanel />
    </div>
  );
}
