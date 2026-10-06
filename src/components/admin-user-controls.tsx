"use client";
import { Notice } from "./page-patterns";
import { useActionState, useId, useRef } from "react";
import { changeUser } from "@/app/admin/users/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type ManagedUser = {
  uid: string;
  displayName: string;
  role: "admin" | "member";
  status: "active" | "suspended";
};
function ChangeForm({
  kind,
  user,
  actorUid,
}: {
  kind: "access" | "profile";
  user: ManagedUser;
  actorUid: string;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    changeUser.bind(null, kind, actorUid, user.uid),
    { message: "", saved: false },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kind === "access" ? "Role and access" : "Application profile"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form id={id} ref={form} action={action} className="space-y-5">
          <input type="hidden" name="confirmed" value="yes" />
          {kind === "profile" ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>Display name</Label>
              <Input
                id={`${id}-name`}
                name="displayName"
                defaultValue={user.displayName}
                required
                minLength={1}
                maxLength={80}
                disabled={pending}
              />
            </div>
          ) : (
            <>
              {(
                [
                  { name: "role", options: ["member", "admin"] },
                  { name: "status", options: ["active", "suspended"] },
                ] as const
              ).map((group) => (
                <fieldset key={group.name} className="space-y-2">
                  <legend className="text-sm font-medium capitalize">
                    {group.name}
                  </legend>
                  <RadioGroup
                    name={group.name}
                    defaultValue={user[group.name]}
                    disabled={pending}
                  >
                    {group.options.map((option) => (
                      <div key={option} className="flex items-center gap-2">
                        <RadioGroupItem id={`${id}-${option}`} value={option} />
                        <Label
                          htmlFor={`${id}-${option}`}
                          className="capitalize"
                        >
                          {option}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </fieldset>
              ))}
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>Reason</Label>
            <Input
              id={`${id}-reason`}
              name="reason"
              required
              minLength={5}
              maxLength={300}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the administrator audit history. Do not enter
              passwords or other secrets.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={pending}>
                {pending ? "Saving…" : "Review change"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm account change</AlertDialogTitle>
                <AlertDialogDescription>
                  {kind === "access"
                    ? "Access changes take effect immediately. Reactivation requires a new sign-in."
                    : "This changes the application display name."}{" "}
                  The change and your reason will be audited.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    type="submit"
                    form={id}
                    onClick={(event) => {
                      if (!form.current?.reportValidity())
                        event.preventDefault();
                    }}
                  >
                    Confirm change
                  </Button>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {state.message && (
            <Notice
              tone={state.saved ? "success" : "error"}
              title={state.message}
            />
          )}
        </form>
      </CardContent>
    </Card>
  );
}
export function AdminUserControls({
  user,
  actorUid,
}: {
  user: ManagedUser;
  actorUid: string;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Changes require a sign-in within the last five minutes. You cannot
        remove your own administrator access.
      </p>
      <ChangeForm kind="access" user={user} actorUid={actorUid} />
      <ChangeForm kind="profile" user={user} actorUid={actorUid} />
    </div>
  );
}
