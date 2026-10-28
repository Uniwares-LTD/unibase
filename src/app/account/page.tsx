import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { ProfileForm } from "@/components/profile-form";
import { Card, CardContent } from "@/components/ui/card";
import { getAuthConfig } from "@/lib/server/auth-config";
import { getSession } from "@/lib/server/session";
import { getMyProfile } from "@/lib/server/profiles";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m7e1b0d5641f2") };
}

export default async function AccountPage() {
  const translate = await getTranslations("ui");

  const session = await getSession();
  const profile = session?.email_verified ? await getMyProfile() : null;
  return (
    <PageMessages path="/account">
      {
        <div className="max-w-2xl page-stack">
          <PageHeader
            title={translate("m7e1b0d5641f2")}
            description={translate(profile ? "m48839b69e560" : "m250a4fe2e585")}
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
        </div>
      }
    </PageMessages>
  );
}
