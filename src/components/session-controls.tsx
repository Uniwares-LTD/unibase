"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { successSchema } from "@/lib/contracts/profile";
import { Button } from "./ui/button";

export function SessionControls() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "unitale-session-event") location.replace("/account");
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) location.reload();
    };
    addEventListener("storage", changed);
    addEventListener("pageshow", restored);
    return () => {
      removeEventListener("storage", changed);
      removeEventListener("pageshow", restored);
    };
  }, []);
  async function logout() {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/session", successSchema, { method: "DELETE" });
      localStorage.setItem("unitale-session-event", String(Date.now()));
      location.replace("/account");
    } catch {
      setError("Couldn’t sign out. Please try again.");
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={pending} onClick={logout}>
        {pending ? "Signing out…" : "Sign out / switch account"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
