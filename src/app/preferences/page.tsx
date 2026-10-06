import { PageHeader } from "@/components/page-patterns";
import type { Metadata } from "next";
import { DiagnosticsPanel } from "@/components/diagnostics-panel";
import { ThemePreference } from "@/components/theme-preference";
import { StylePreference } from "@/components/style-preference";
import { ProfileForm } from "@/components/profile-form";
import { SessionControls } from "@/components/session-controls";
import { getSession } from "@/lib/server/session";
import { getMyProfile } from "@/lib/server/profiles";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export const metadata: Metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const session = await getSession();
  const profile = session?.email_verified ? await getMyProfile() : null;
  return (
    <div className="max-w-3xl page-stack">
      <PageHeader
        title="Preferences"
        description="Choose your appearance and manage browser diagnostics."
      />
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose the look you prefer, or let your device decide.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profile ? (
            <div className="space-y-6">
              <ProfileForm key={profile.uid} profile={profile} />
              <SessionControls />
            </div>
          ) : (
            <div className="space-y-8">
              <StylePreference />
              <ThemePreference />
            </div>
          )}
        </CardContent>
      </Card>
      <DiagnosticsPanel />
    </div>
  );
}
