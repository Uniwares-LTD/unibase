"use client";
import { useTranslations } from "next-intl";

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
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const id = useId();
  const { preference, defaultStyle, setPreference } = useStyle();
  const choices = [
    {
      value: "default",
      label: translate("m7c40d0132c82"),
      description: common("followStyle", { style: defaultStyle }),
    },
    {
      value: "classic",
      label: translate("mae25d6481fc1"),
      description: translate("m2c6fcf59cf32"),
    },
    {
      value: "glass",
      label: translate("m82c268188cd6"),
      description: translate("m6e472a5c3c85"),
    },
    {
      value: "soft-blue",
      label: translate("m66075117b4a0"),
      description: translate("m021086bacd4b"),
    },
  ];
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-medium">
        {translate("mf0702a028b19")}
      </legend>
      <RadioGroup
        name={account ? "style" : undefined}
        aria-label={translate("mf0702a028b19")}
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
        {translate("mcda29bef33e3")}{" "}
        {account ? translate("m432aa8c5e499") : translate("mb1fc543247a5")}
      </p>
    </fieldset>
  );
}
