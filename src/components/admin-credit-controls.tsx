"use client";
import { useTranslations } from "next-intl";

import { Notice } from "./page-patterns";
import { useActionState, useId, useRef, useState } from "react";
import { adjustUserCredits } from "@/app/admin/users/credit-actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
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

export function AdminCreditControls({
  uid,
  actorUid,
  initialKey,
}: {
  uid: string;
  actorUid: string;
  initialKey: string;
}) {
  const translate = useTranslations("ui");

  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState(initialKey);
  const [expiry, setExpiry] = useState("default");
  const [direction, setDirection] = useState("grant");
  const [state, action, pending] = useActionState(
    async (previous: { message: string; saved: boolean }, form: FormData) => {
      const result = await adjustUserCredits(actorUid, uid, previous, form);
      if (result.saved) setKey(crypto.randomUUID());
      return result;
    },
    { message: "", saved: false },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("m392bb77ad9bf")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form id={id} ref={formRef} action={action} className="space-y-5">
          <input type="hidden" name="key" value={key} />
          <input type="hidden" name="confirmed" value="yes" />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {translate("mc416069b7f61")}
            </legend>
            <RadioGroup
              name="direction"
              value={direction}
              onValueChange={setDirection}
              disabled={pending}
            >
              {[
                ["grant", translate("mb2874ddcc6cd")],
                ["deduct", translate("ma9fb5476cc11")],
              ].map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`${id}-${value}`} />
                  <Label htmlFor={`${id}-${value}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`${id}-amount`}>{translate("m0917222b9166")}</Label>
            <Input
              type="number"
              id={`${id}-amount`}
              name="amount"
              min={1}
              max={Number.MAX_SAFE_INTEGER}
              step={1}
              required
              disabled={pending}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              {translate("mfc4224acbacd")}
            </legend>
            <RadioGroup
              name="expiry"
              value={expiry}
              onValueChange={setExpiry}
              disabled={pending || direction !== "grant"}
            >
              {[
                ["default", translate("m5499359c8cbe")],
                ["perpetual", translate("mfe06351db8da")],
                ["custom", translate("m87a565572d6d")],
              ].map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`${id}-${value}`} />
                  <Label htmlFor={`${id}-${value}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          {direction === "grant" && expiry === "custom" && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-expires`}>
                {translate("m69ac01f0a993")}{" "}
              </Label>
              <Input
                type="datetime-local"
                id={`${id}-expires`}
                name="expiresAt"
                required
                disabled={pending}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-reason`}>
              {translate("m7019eb977268")}{" "}
            </Label>
            <Input
              id={`${id}-reason`}
              name="reason"
              maxLength={300}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {translate("m693900292adb")}{" "}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {translate("me12e1f257817")}{" "}
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={pending}>
                {pending
                  ? translate("m23e39291d613")
                  : translate("m9882a78b6a80")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {translate("m4809e4db7cb4")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {translate("m7f1e0ccdb520")}{" "}
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
                    onClick={(event) => {
                      if (!formRef.current?.reportValidity())
                        event.preventDefault();
                    }}
                  >
                    {translate("m402f34285a9b")}{" "}
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
