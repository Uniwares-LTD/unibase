"use client";
import { StateLabel } from "./localized-value";
import { useTranslations } from "next-intl";

import { useActionState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { saveAppearance } from "@/app/account/actions";
import type { Profile } from "@/lib/contracts/profile";
import { Notice } from "./page-patterns";
import { StylePreference } from "./style-preference";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

const subscribe = () => () => {};

export function AppearanceForm({ profile }: { profile: Profile }) {
  const translate = useTranslations("ui");

  const [state, action, pending] = useActionState(
    saveAppearance.bind(null, profile.uid),
    { message: "", saved: false },
  );
  // Show and save this browser's current look; the account look is applied at
  // sign-in, so opening this page never overrides a choice made here.
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
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
          value={hydrated ? (theme ?? profile.theme) : ""}
          onValueChange={setTheme}
          disabled={pending || !hydrated}
        >
          {["light", "dark", "system"].map((theme) => (
            <div key={theme} className="flex items-center gap-2">
              <RadioGroupItem id={`profile-${theme}`} value={theme} />
              <Label htmlFor={`profile-${theme}`}>
                <StateLabel value={theme} />
              </Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">
          {translate("m64c7a3da6a24")}
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
