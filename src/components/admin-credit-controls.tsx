"use client";
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
        <CardTitle>Credit adjustment</CardTitle>
      </CardHeader>
      <CardContent>
        <form id={id} ref={formRef} action={action} className="space-y-5">
          <input type="hidden" name="key" value={key} />
          <input type="hidden" name="confirmed" value="yes" />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Adjustment</legend>
            <RadioGroup
              name="direction"
              value={direction}
              onValueChange={setDirection}
              disabled={pending}
            >
              {[
                ["grant", "Grant promotional credits"],
                ["deduct", "Deduct available credits"],
              ].map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`${id}-${value}`} />
                  <Label htmlFor={`${id}-${value}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`${id}-amount`}>Credit amount</Label>
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
            <legend className="text-sm font-medium">Grant expiry</legend>
            <RadioGroup
              name="expiry"
              value={expiry}
              onValueChange={setExpiry}
              disabled={pending || direction !== "grant"}
            >
              {[
                ["default", "Default: 90 days"],
                ["perpetual", "No expiry"],
                ["custom", "Specific date (UTC)"],
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
                Expiry date and time (UTC)
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
              Credit adjustment reason (optional)
            </Label>
            <Input
              id={`${id}-reason`}
              name="reason"
              maxLength={300}
              disabled={pending}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the ledger and admin audit; visible to the account
              owner. Do not enter secrets.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Requires sign-in within 30 minutes. Deductions cannot consume held
            credits or create debt. Grants cover existing debt first.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={pending}>
                {pending ? "Saving…" : "Review credit adjustment"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm credit adjustment</AlertDialogTitle>
                <AlertDialogDescription>
                  This immediately changes this account’s credits and records
                  your reason. Check the amount, direction and grant expiry
                  before confirming.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button
                    type="submit"
                    form={id}
                    onClick={(event) => {
                      if (!formRef.current?.reportValidity())
                        event.preventDefault();
                    }}
                  >
                    Confirm adjustment
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
