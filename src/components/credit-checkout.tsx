"use client";
import { Notice } from "./page-patterns";
import { useActionState, useEffect, useState } from "react";
import { paymentContext } from "@/lib/payment-context";
import { checkoutCredits } from "@/app/credits/checkout-action";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

export function CreditCheckout({
  uid,
  packs,
  initialKey,
}: {
  uid: string;
  initialKey: string;
  packs: {
    id: string;
    label: string;
    credits: number;
    amountMinor?: number;
    currency?: string;
  }[];
}) {
  const [state, action, pending] = useActionState(
    checkoutCredits.bind(null, uid),
    { message: "" },
  );
  const [context, setContext] = useState<"checking" | "web" | "play">(
    "checking",
  );
  useEffect(() => {
    let active = true;
    let markedPlay = false;
    try {
      markedPlay = sessionStorage.getItem("unitale-play-context") === "yes";
    } catch {
      /* browser storage is optional */
    }
    const browser = window as Window & {
      getDigitalGoodsService?: (provider: string) => Promise<unknown>;
    };
    void paymentContext({
      referrer: document.referrer,
      search: location.search,
      markedPlay,
      digitalGoods: browser.getDigitalGoodsService
        ? () =>
            browser.getDigitalGoodsService!("https://play.google.com/billing")
        : undefined,
    }).then((value) => {
      if (!active) return;
      if (value === "play") {
        try {
          sessionStorage.setItem("unitale-play-context", "yes");
        } catch {
          /* retain the in-memory decision */
        }
      }
      setContext(value);
    });
    return () => {
      active = false;
    };
  }, []);
  if (context === "play")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Purchases in the Play application are unavailable until Play billing is
        enabled. No web checkout is offered here.
      </p>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Buy credits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          One-time purchases through Stripe Checkout. Credits arrive after
          payment verification. Returning here does not confirm payment; refresh
          your balance after processing.
        </p>
        <form action={action} className="flex flex-wrap gap-3">
          <input type="hidden" name="key" value={initialKey} />
          {packs.map((pack) => (
            <Button
              key={pack.id}
              type="submit"
              name="packId"
              value={pack.id}
              disabled={pending || context !== "web"}
            >
              {pack.label} · {pack.credits} credits
            </Button>
          ))}
        </form>
        <p className="text-sm text-muted-foreground">
          Price and currency are confirmed on Checkout before paying.
        </p>
        {state.message && <Notice tone={"error"} title={state.message} />}
      </CardContent>
    </Card>
  );
}
