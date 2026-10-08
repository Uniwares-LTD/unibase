"use client";
import Image from "next/image";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { WorkspaceView } from "@/lib/contracts/workspace";

export function ImageReferencePicker({
  assets,
  value,
  onChange,
  disabled,
}: {
  assets: WorkspaceView["assets"];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const images = assets.filter((asset) => asset.mime === "image/png");
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">
        Reference images (optional, up to four)
      </legend>
      <p className="text-sm text-muted-foreground">
        Selected references and the current image when editing are sent to the
        configured image provider. Source artifacts supply text context; select
        image references here to send their pixels.
      </p>
      {!images.length && (
        <p className="text-sm">
          Upload a private image below to use it as a reference.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {images.map((asset) => (
          <Label key={asset.id} className="min-w-0 gap-3 rounded-md border p-3">
            <Checkbox
              checked={value.includes(asset.id)}
              disabled={
                disabled || (value.length >= 4 && !value.includes(asset.id))
              }
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...value, asset.id]
                    : value.filter((id) => id !== asset.id),
                )
              }
            />
            <Image
              unoptimized
              src={`/api/workspace-assets/${asset.id}`}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 shrink-0 rounded object-cover"
            />
            <span className="min-w-0 break-words">{asset.name}</span>
          </Label>
        ))}
      </div>
    </fieldset>
  );
}
