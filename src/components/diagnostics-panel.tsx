"use client";
import { useSyncExternalStore } from "react";
import { diagnostics } from "@/lib/client/diagnostics";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export function DiagnosticsPanel() {
  const enabled = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.isEnabled,
    () => false,
  );
  const count = useSyncExternalStore(
    diagnostics.subscribe,
    () => diagnostics.entries().length,
    () => 0,
  );
  function download() {
    const url = URL.createObjectURL(
      new Blob([diagnostics.export()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "unitale-diagnostics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Browser diagnostics</CardTitle>
        <CardDescription>
          Collect event types, timing, response status and request IDs in this
          tab only. No messages, account details or page addresses are
          collected. Turning this off or reloading clears the buffer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status">
          {enabled
            ? `${count} of up to 100 events collected.`
            : "Diagnostics are off."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            aria-pressed={enabled}
            onClick={() => diagnostics.setEnabled(!enabled)}
          >
            {enabled ? "Disable and clear diagnostics" : "Enable diagnostics"}
          </Button>
          <Button
            variant="outline"
            disabled={!enabled || count === 0}
            onClick={download}
          >
            Export diagnostics
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
