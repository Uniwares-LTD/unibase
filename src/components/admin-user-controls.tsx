"use client";
import { StateLabel } from "./localized-value";
import { useTranslations } from "next-intl";

import { Notice } from "./page-patterns";
import { useActionState, useId, useRef, useState } from "react";
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
  const translate = useTranslations("ui");
  const states = useTranslations("states");

  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [change, setChange] = useState({ summary: "", risky: false });
  const [state, action, pending] = useActionState(
    changeUser.bind(null, kind, actorUid, user.uid),
    { message: "", saved: false },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kind === "access"
            ? translate("mfacc8e750d37")
            : translate("m57af318d79ea")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form id={id} ref={form} action={action} className="space-y-5">
          <input type="hidden" name="confirmed" value="yes" />
          {kind === "profile" ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>{translate("m2b7f6a84de91")}</Label>
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
                  <legend className="text-sm font-medium">
                    <StateLabel value={group.name} />
                  </legend>
                  <RadioGroup
                    name={group.name}
                    defaultValue={user[group.name]}
                    disabled={pending}
                  >
                    {group.options.map((option) => (
                      <div key={option} className="flex items-center gap-2">
                        <RadioGroupItem id={`${id}-${option}`} value={option} />
                        <Label htmlFor={`${id}-${option}`}>
                          <StateLabel value={option} />
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </fieldset>
              ))}
            </>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>{translate("m0f7d4664a9bc")}</Label>
            <Input
              id={`${id}-reason`}
              name="reason"
              maxLength={300}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {translate("m55aae024034e")}
            </p>
          </div>
          <AlertDialog
            onOpenChange={(open) => {
              if (!open || !form.current) return;
              // Name the exact before/after values in the confirmation.
              const data = new FormData(form.current);
              if (kind === "profile") {
                setChange({
                  summary: translate("m04cd39380d7b", {
                    from: user.displayName,
                    to: String(data.get("displayName") ?? ""),
                  }),
                  risky: false,
                });
                return;
              }
              const role = String(data.get("role") ?? user.role);
              const status = String(data.get("status") ?? user.status);
              setChange({
                summary: translate("m19556d039b80", {
                  fromRole: states(user.role),
                  toRole: states(role as ManagedUser["role"]),
                  fromStatus: states(user.status),
                  toStatus: states(status as ManagedUser["status"]),
                }),
                risky:
                  (user.role === "admin" && role === "member") ||
                  (user.status === "active" && status === "suspended"),
              });
            }}
          >
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={pending}>
                {pending
                  ? translate("m23e39291d613")
                  : translate("mda59c55382da")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {translate("m8accb43f940d")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <span className="block font-medium text-foreground">
                    {change.summary}
                  </span>
                  {kind === "access"
                    ? translate("mea2566c4c00e")
                    : translate("m8b84d40526a0")}{" "}
                  {translate("mcbc1ff7ddf4c")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {translate("m19766ed6ccb2")}
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    type="submit"
                    form={id}
                    variant={change.risky ? "destructive" : "default"}
                    onClick={(event) => {
                      if (!form.current?.reportValidity())
                        event.preventDefault();
                    }}
                  >
                    {translate("m704ac1d7acd8")}
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
  const translate = useTranslations("ui");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {translate("mbd90f64a0b40")}
      </p>
      <ChangeForm kind="access" user={user} actorUid={actorUid} />
      <ChangeForm kind="profile" user={user} actorUid={actorUid} />
    </div>
  );
}
