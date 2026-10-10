"use client";
import { useState } from "react";
import { announceSessionChange } from "@/lib/client/session-lifecycle";
import { api } from "@/lib/client/api";
import { successSchema } from "@/lib/contracts/profile";
import { LogOut } from "lucide-react";
import { DropdownMenuItem } from "./ui/dropdown-menu";

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
    <>
      <DropdownMenuItem
        disabled={pending}
        onSelect={(event) => {
          event.preventDefault();
          void logout();
        }}
      >
        <LogOut aria-hidden="true" />
        {pending ? "Signing out…" : "Sign out"}
      </DropdownMenuItem>
      {error && (
        <p role="alert" className="px-2 py-1.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
