"use client";
import { useEffect } from "react";
import { diagnostics } from "@/lib/client/diagnostics";

export function BrowserRuntime() {
  useEffect(() => {
    // Listeners observe only event types; never suppress browser/React handling.
    const error = () => diagnostics.record("browser-error");
    const rejection = () => diagnostics.record("unhandled-rejection");
    const online = () => diagnostics.record("online");
    const offline = () => diagnostics.record("offline");
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(
          () => diagnostics.record("worker-ready"),
          () => diagnostics.record("worker-failed"),
        );
    }
    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
  return null;
}
