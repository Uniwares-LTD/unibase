import { PageMessages } from "@/components/page-messages";
import { LocalizationPreference } from "@/components/localization-preference";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import { ThemePreference } from "@/components/theme-preference";
import { StylePreference } from "@/components/style-preference";
import { AppearanceForm } from "@/components/appearance-form";
import { getSession } from "@/lib/server/session";
import { getMyProfile } from "@/lib/server/profiles";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m66962f72a088") };
}

export default async function PreferencesPage() {
  const translate = await getTranslations("ui");

  const session = await getSession();
  const profile = session?.email_verified ? await getMyProfile() : null;
  return (
    <PageMessages path="/preferences">
      {
        <div className="max-w-3xl page-stack">
          <PageHeader
            title={translate("m66962f72a088")}
            description={translate("m153b3363f9a5")}
          />
          <LocalizationPreference canSave={!!profile} />
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle>{translate("m3907fa7f8072")}</CardTitle>
              <CardDescription>{translate("me6ced602ea08")} </CardDescription>
            </CardHeader>
            <CardContent>
              {profile ? (
                <div className="space-y-6">
                  <AppearanceForm key={profile.uid} profile={profile} />
                </div>
              ) : (
                <div className="space-y-8">
                  <StylePreference />
                  <ThemePreference />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      }
    </PageMessages>
  );
}
