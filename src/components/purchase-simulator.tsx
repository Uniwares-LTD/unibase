"use client";
import { Notice } from "./page-patterns";
import { useActionState, useId, useState } from "react";
import { applySimulation, startSimulation } from "@/app/credits/actions";
import type { PublicOrder, PublicPack } from "@/lib/contracts/credits";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Label } from "./ui/label";

function Order({ order, uid }: { order: PublicOrder; uid: string }) {
  const [state, action, pending] = useActionState(
    applySimulation.bind(null, uid, order.id),
    { message: "", saved: false },
  );
  const options =
    order.status === "pending"
      ? [
          ["success", "Success"],
          ["pending", "Keep pending"],
          ["failure", "Fail"],
          ["cancel", "Cancel"],
        ]
      : order.status === "paid"
        ? [
            ["refund", "Refund all"],
            ["replay", "Replay success"],
          ]
        : order.status === "refunded"
          ? [["replay", "Replay success"]]
          : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {order.label} · {order.status}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="break-all text-xs text-muted-foreground">
          Simulation {order.id.slice(0, 12)} ·{" "}
          {order.createdAt.slice(0, 16).replace("T", " ")} UTC
        </p>
        <form action={action} className="flex flex-wrap gap-2">
          {options.map(([event, label]) => (
            <Button
              key={event}
              name="event"
              value={event}
              type="submit"
              variant="outline"
              disabled={pending}
            >
              {label}
            </Button>
          ))}
        </form>
        {state.message && (
          <Notice
            tone={state.saved ? "success" : "error"}
            title={state.message}
          />
        )}
      </CardContent>
    </Card>
  );
}
export function PurchaseSimulator({
  packs,
  orders,
  uid,
  initialKey,
}: {
  packs: PublicPack[];
  orders: PublicOrder[];
  uid: string;
  initialKey: string;
}) {
  const id = useId();
  const [key, setKey] = useState(initialKey);
  const [state, action, pending] = useActionState(
    async (previous: { message: string; saved: boolean }, form: FormData) => {
      const result = await startSimulation(uid, previous, form);
      if (result.saved) setKey(crypto.randomUUID());
      return result;
    },
    { message: "", saved: false },
  );
  return (
    <section className="space-y-4" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-xl font-semibold">
        Local purchase simulation
      </h2>
      <Notice title="No real money is charged">
        Fixture packs for local testing. No real payment or provider account is
        involved. Simulation is unavailable in staging and production.
      </Notice>
      <Card>
        <CardContent className="py-6">
          <form action={action} className="space-y-4">
            <input type="hidden" name="key" value={key} />
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Simulated credit pack
              </legend>
              <RadioGroup
                name="packId"
                defaultValue={packs[0]?.id}
                disabled={pending}
              >
                {packs.map((pack) => (
                  <div key={pack.id} className="flex items-center gap-2">
                    <RadioGroupItem value={pack.id} id={`${id}-${pack.id}`} />
                    <Label htmlFor={`${id}-${pack.id}`}>{pack.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create simulated purchase"}
            </Button>
            {state.message && (
              <Notice
                tone={state.saved ? "success" : "error"}
                title={state.message}
              />
            )}
          </form>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Latest 25 simulated purchases.
      </p>
      <div className="space-y-4">
        {orders.map((order) => (
          <Order key={order.id} order={order} uid={uid} />
        ))}
      </div>
    </section>
  );
}
