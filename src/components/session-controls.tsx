"use client";
import { useState } from "react";
import { announceSessionChange } from "@/lib/client/session-lifecycle";
import { api } from "@/lib/client/api";
import { successSchema } from "@/lib/contracts/profile";
import { Button } from "./ui/button";

export function SessionControls() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    try {
      await api("/api/auth/session", successSchema, { method: "DELETE" });
      announceSessionChange();
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
