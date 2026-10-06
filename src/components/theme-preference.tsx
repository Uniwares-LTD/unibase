"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const choices = [
  {
    value: "light",
    label: "Light",
    description: "A bright, clear canvas.",
    Icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "A softer view after hours.",
    Icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow your device settings.",
    Icon: Monitor,
  },
];

export function ThemePreference() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  return (
    <fieldset>
      <legend className="mb-4 text-sm font-medium">Color mode</legend>
      <RadioGroup
        aria-label="Color mode"
        value={hydrated ? (theme ?? "system") : ""}
        onValueChange={setTheme}
        disabled={!hydrated}
        className="grid gap-3 sm:grid-cols-3"
      >
        {choices.map(({ value, label, description, Icon }) => (
          <label
            key={value}
            htmlFor={`theme-${value}`}
            className="flex cursor-pointer flex-col gap-5 rounded-xl border bg-background p-5 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring motion-reduce:transition-none"
          >
            <span className="flex items-center justify-between">
              <Icon
                aria-hidden="true"
                className="size-5 text-muted-foreground"
              />
              <RadioGroupItem
                value={value}
                id={`theme-${value}`}
                aria-label={label}
              />
            </span>
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {description}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <p className="mt-5 text-sm text-muted-foreground" aria-live="polite">
        {hydrated
          ? "Your preference is saved in this browser."
          : "Loading your appearance preference…"}
      </p>
    </fieldset>
  );
}
