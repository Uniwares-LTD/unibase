"use client";

import { useState } from "react";
import { creationCardExamples } from "@/lib/creation/examples";
import { cardRegistry, type CardAction } from "@/lib/creation/cards";
import type { RegisteredValue } from "@/lib/creation/registry";
import { RegisteredCard } from "./workspaces/registered-card";
import { Button } from "./ui/button";

export function CreationShowcase() {
  const [cards, setCards] = useState(creationCardExamples);
  const [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  function respond(
    id: string,
    action: CardAction,
    value: RegisteredValue["data"],
  ) {
    const card = cards.find((item) => item.id === id);
    if (!card) return;
    try {
      const response = cardRegistry
        .get(card.content.type, card.content.version)
        .response(card.content.data, action, value);
      setCards((old) =>
        old.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "answered",
                responseAction: action,
                response,
                answeredAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setError("");
      setNotice("Sample response recorded in this page only.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invalid sample response.",
      );
    }
  }
  return (
    <section aria-labelledby="creation-examples" className="space-y-4">
      <h2 id="creation-examples" className="text-2xl font-semibold">
        Generative UI examples
      </h2>
      <p className="text-sm text-muted-foreground">
        These examples use the workspace card renderers. Responses stay in
        memory; reloading or resetting clears them. Review actions do not
        approve real work. Gallery choices are unavailable until a real
        workspace supplies owned images. Progress and review cards are issued by
        the application.
      </p>
      <Button
        variant="outline"
        onClick={() => {
          setCards(creationCardExamples());
          setGeneration((old) => old + 1);
          setError("");
          setNotice("Examples reset.");
        }}
      >
        Reset examples
      </Button>
      <p role="status" className="text-sm">
        {notice}
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {cards.map((card) => (
          <RegisteredCard
            key={`${generation}:${card.id}`}
            card={card}
            disabled={false}
            onRespond={(action, value) => respond(card.id, action, value)}
            onReopen={() => {
              setCards((old) =>
                old.map((item) =>
                  item.id === card.id
                    ? {
                        ...item,
                        status: "active",
                        response: null,
                        responseAction: null,
                        answeredAt: null,
                      }
                    : item,
                ),
              );
              setNotice("Sample reopened.");
            }}
          />
        ))}
      </div>
    </section>
  );
}
