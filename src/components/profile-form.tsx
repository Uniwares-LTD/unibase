"use client";
import { Notice } from "./page-patterns";
import { StylePreference } from "./style-preference";
import { useStyle } from "./style-provider";
import { useActionState, useEffect, useEffectEvent } from "react";
import { useTheme } from "next-themes";
import { saveProfile } from "@/app/account/actions";
import type { Profile } from "@/lib/contracts/profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(
    saveProfile.bind(null, profile.uid),
    { message: "", saved: false },
  );
  const { setTheme } = useTheme();
  const { setPreference } = useStyle();
  const applySavedTheme = useEffectEvent((theme: Profile["theme"]) => {
    setTheme(theme);
  });
  useEffect(() => {
    // A browser/cross-tab theme change must not reapply the saved account value.
    applySavedTheme(profile.theme);
  }, [profile.theme]);
  useEffect(() => {
    setPreference(profile.style);
  }, [profile.style, setPreference]);
  return (
    <form action={action} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={profile.displayName}
          autoComplete="name"
          minLength={1}
          maxLength={80}
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <Label>Email</Label>
        <p className="break-all text-sm">{profile.email}</p>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Account appearance</legend>
        <RadioGroup
          name="theme"
          defaultValue={profile.theme}
          onValueChange={setTheme}
          disabled={pending}
        >
          {["light", "dark", "system"].map((theme) => (
            <div key={theme} className="flex items-center gap-2">
              <RadioGroupItem id={`profile-${theme}`} value={theme} />
              <Label htmlFor={`profile-${theme}`} className="capitalize">
                {theme}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          Changes apply immediately in this browser. Save your profile to
          remember this color mode on your account too.
        </p>
      </fieldset>
      <StylePreference account disabled={pending} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </Button>
      {state.message && (
        <Notice
          tone={state.saved ? "success" : "error"}
          title={state.message}
        />
      )}
    </form>
  );
}
