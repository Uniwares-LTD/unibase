"use client";
import { Button } from "@/components/ui/button";
import { currentVersion, type WorkspaceView } from "@/lib/contracts/workspace";
export function SourcePicker({
  workspace,
  value,
  onChange,
  disabled,
  exclude,
}: {
  workspace: WorkspaceView;
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
  exclude?: string;
}) {
  if (!workspace.artifacts.some((a) => a.id !== exclude)) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Source artifacts (optional)
      </legend>
      <div className="flex flex-wrap gap-2">
        {workspace.artifacts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <Button
              type="button"
              key={a.id}
              variant={value.includes(a.id) ? "secondary" : "outline"}
              aria-pressed={value.includes(a.id)}
              disabled={disabled}
              className="h-auto max-w-full whitespace-normal"
              onClick={() =>
                onChange(
                  value.includes(a.id)
                    ? value.filter((id) => id !== a.id)
                    : [...value, a.id],
                )
              }
            >
              {currentVersion(a).title} · v{currentVersion(a).number}
            </Button>
          ))}
      </div>
    </fieldset>
  );
}
