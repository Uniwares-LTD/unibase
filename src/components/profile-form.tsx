"use client";
import { Notice } from "./page-patterns";
import { useActionState } from "react";
import { saveProfile } from "@/app/account/actions";
import type { Profile } from "@/lib/contracts/profile";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(
    saveProfile.bind(null, profile.uid),
    { message: "", saved: false },
  );
  return (
    <form
      action={action}
      className="space-y-6"
      onResetCapture={(event) => {
        // Keep the saved display name visible after React resets the form.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
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
