"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { invalidateBrowserSession } from "@/lib/client/session-lifecycle";

export function SessionBoundary({ children }: { children: ReactNode }) {
  const [invalid, setInvalid] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clear = () => flushSync(() => setInvalid(true));
    const reload = () => {
      invalidateBrowserSession();
      location.replace("/account");
    };
    const changed = (event: StorageEvent) => {
      if (event.key === "unitale-session-event") reload();
    };
    const hide = (event: PageTransitionEvent) => {
      // Do not save private content in a visible back-forward-cache snapshot.
      if (event.persisted && root.current) root.current.hidden = true;
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) reload();
    };
    window.addEventListener("base-session-invalidated", clear);
    window.addEventListener("storage", changed);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("base-session-invalidated", clear);
      window.removeEventListener("storage", changed);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restored);
    };
  }, []);
  return (
    <div ref={root}>
      {invalid ? <p role="status">Account changed. Reloading…</p> : children}
    </div>
  );
}
