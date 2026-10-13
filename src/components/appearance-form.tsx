"use client";
import { StateLabel } from "./localized-value";
import { useTranslations } from "next-intl";

import { useActionState, useEffect, useEffectEvent } from "react";
import { useTheme } from "next-themes";
import { saveAppearance } from "@/app/account/actions";
import type { Profile } from "@/lib/contracts/profile";
import { Notice } from "./page-patterns";
import { StylePreference } from "./style-preference";
import { useStyle } from "./style-provider";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

export function AppearanceForm({ profile }: { profile: Profile }) {
  const translate = useTranslations("ui");

  const [state, action, pending] = useActionState(
    saveAppearance.bind(null, profile.uid),
    { message: "", saved: false },
  );
  const { setTheme } = useTheme();
  const { setPreference } = useStyle();
  const applySavedTheme = useEffectEvent((theme: Profile["theme"]) => {
    setTheme(theme);
  });
  useEffect(() => {
    applySavedTheme(profile.theme);
  }, [profile.theme]);
  useEffect(() => {
    setPreference(profile.style);
  }, [profile.style, setPreference]);
  return (
    <form
      action={action}
      className="space-y-6"
      onResetCapture={(event) => {
        // Prevent form resets from restoring the old Radix value after a save.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          {translate("m9f1e7d7d98b2")}
        </legend>
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
                <StateLabel value={theme} />
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          {translate("m4121fec7f306")}{" "}
        </p>
      </fieldset>
      <StylePreference account disabled={pending} />
      <Button type="submit" disabled={pending}>
        {pending ? translate("m23e39291d613") : translate("m089e57e38f93")}
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
