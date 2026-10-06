"use client";

import { useId } from "react";
import { useStyle } from "./style-provider";
import { parseStylePreference } from "@/lib/appearance";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Label } from "./ui/label";

export function StylePreference({
  account = false,
  disabled = false,
}: {
  account?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const { preference, defaultStyle, setPreference } = useStyle();
  const choices = [
    {
      value: "default",
      label: "Application default",
      description: `Follow the application's ${defaultStyle} style.`,
    },
    {
      value: "classic",
      label: "Classic",
      description: "Warm paper, terracotta accents and book-like headings.",
    },
    {
      value: "glass",
      label: "Glass",
      description: "Pearlescent backgrounds, frosted surfaces and soft light.",
    },
    {
      value: "soft-blue",
      label: "Soft Blue",
      description: "Cobalt actions, pale lavender surfaces and rounded panels.",
    },
  ];
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">Design style</legend>
      <RadioGroup
        name={account ? "style" : undefined}
        aria-label="Design style"
        value={preference}
        onValueChange={(value) => setPreference(parseStylePreference(value))}
        disabled={disabled}
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-describedby={`${id}-help`}
      >
        {choices.map((choice) => (
          <Label
            key={choice.value}
            htmlFor={`${id}-${choice.value}`}
            className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 has-[[data-state=checked]]:border-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
          >
            <RadioGroupItem
              id={`${id}-${choice.value}`}
              aria-label={choice.label}
              value={choice.value}
              className="mt-0.5"
            />
            <span>
              <span className="block font-semibold">{choice.label}</span>
              <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                {choice.description}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        Changes apply immediately and are remembered in this browser.
        {account
          ? " Save your profile to remember this style on your account too."
          : " Light, dark and system mode are separate settings."}
      </p>
    </fieldset>
  );
}
