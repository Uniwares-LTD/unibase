"use client";

import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import type { FirebaseBrowserConfig } from "@/lib/config/auth";
import { browserAuth, redirectCredential } from "@/lib/client/firebase";
import { GOOGLE_REDIRECT_KEY, redirectUser } from "@/lib/client/redirect-state";
import { api, ApiError } from "@/lib/client/api";
import { announceSessionChange } from "@/lib/client/session-lifecycle";
import { sessionResultSchema } from "@/lib/contracts/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

function message(error: unknown) {
  if (error instanceof ApiError) return error.message;
  const code = (error as { code?: string })?.code;
  if (code === "auth/weak-password")
    return "Choose a password with at least 12 characters.";
  if (code === "auth/too-many-requests")
    return "Too many attempts. Please wait and try again.";
  if (code === "auth/network-request-failed")
    return "Couldn’t reach the account service. Check your connection and try again.";
  return "We couldn’t complete sign-in. Check your details or reset your password.";
}

export function AuthForm({ config }: { config: FirebaseBrowserConfig }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [pending, setPending] = useState(true);
  const [notice, setNotice] = useState("");
  const [unverified, setUnverified] = useState<User | null>(null);

  async function finish(user: User) {
    if (!user.emailVerified) {
      setUnverified(user);
      return;
    }
    const auth = await browserAuth(config);
    await api("/api/auth/session", sessionResultSchema, {
      method: "POST",
      body: { idToken: await user.getIdToken(true) },
    });
    await signOut(auth);
    sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
    announceSessionChange();
  }

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const auth = await browserAuth(config);
        const result = await redirectCredential(config);
        if (!active) return;
        const startedAt = sessionStorage.getItem(GOOGLE_REDIRECT_KEY);
        const user = redirectUser(
          result?.user ?? null,
          auth.currentUser,
          startedAt,
        );
        if (user) await finish(user);
        else if (
          startedAt ||
          new URL(location.href).searchParams.get("auth") === "google"
        ) {
          sessionStorage.removeItem(GOOGLE_REDIRECT_KEY);
          if (auth.currentUser) await signOut(auth);
          setNotice(
            "Google sign-in couldn’t finish. Please try Continue with Google again. If it repeats, check that site storage is allowed for this app.",
          );
        } else if (auth.currentUser && !auth.currentUser.emailVerified)
          setUnverified(auth.currentUser);
        else if (auth.currentUser) await signOut(auth);
      } catch (error) {
        if (active) setNotice(message(error));
      } finally {
        if (active) setPending(false);
      }
    }
    void initialize();
    return () => {
      active = false;
    };
    // Configuration is supplied once by the server for this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  async function perform(action: () => Promise<void>) {
    setPending(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    await perform(async () => {
      const auth = await browserAuth(config);
      if (mode === "reset") {
        try {
          await sendPasswordResetEmail(auth, email, {
            url: `${location.origin}/account`,
          });
        } catch (error) {
          if ((error as { code?: string }).code !== "auth/user-not-found")
            throw error;
        }
        setNotice(
          "If an account exists for that email, a password reset link has been sent.",
        );
        return;
      }
      const result =
        mode === "register"
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      if (mode === "register") {
        setUnverified(result.user);
        await sendEmailVerification(result.user, {
          url: `${location.origin}/account`,
        });
        setNotice("Check your inbox for a verification link.");
      }
      await finish(result.user);
    });
  }

  return (
    <div className="space-y-6">
      {notice && (
        <Alert>
          <AlertDescription role="status">{notice}</AlertDescription>
        </Alert>
      )}
      {unverified ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Verify your email</h2>
          <p className="text-sm text-muted-foreground">
            Open the verification link sent to {unverified.email}, then continue
            here. Your profile stays protected until your email is verified.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={pending}
              onClick={() =>
                perform(async () => {
                  await reload(unverified);
                  if (!unverified.emailVerified) {
                    setNotice("Your email is not verified yet.");
                    return;
                  }
                  await finish(unverified);
                })
              }
            >
              I’ve verified my email
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                perform(async () => {
                  await sendEmailVerification(unverified, {
                    url: `${location.origin}/account`,
                  });
                  setNotice("Verification email sent. Check your inbox.");
                })
              }
            >
              Resend email
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                perform(async () => {
                  await signOut(await browserAuth(config));
                  setUnverified(null);
                  setMode("login");
                })
              }
            >
              Use another account
            </Button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold">
            {mode === "register"
              ? "Create an account"
              : mode === "reset"
                ? "Reset your password"
                : "Sign in"}
          </h2>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={pending}
              />
            </div>
            {mode !== "reset" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  minLength={mode === "register" ? 12 : 1}
                  maxLength={128}
                  required
                  disabled={pending}
                />
                {mode === "register" && (
                  <p className="text-xs text-muted-foreground">
                    Use at least 12 characters.
                  </p>
                )}
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {pending
                ? "Please wait…"
                : mode === "register"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : "Sign in"}
            </Button>
          </form>
          {mode !== "reset" && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                perform(async () => {
                  const auth = await browserAuth(config);
                  await signOut(auth);
                  const provider = new GoogleAuthProvider();
                  provider.setCustomParameters({ prompt: "select_account" });
                  sessionStorage.setItem(
                    GOOGLE_REDIRECT_KEY,
                    String(Date.now()),
                  );
                  const returnUrl = new URL(location.href);
                  returnUrl.searchParams.set("auth", "google");
                  history.replaceState(history.state, "", returnUrl);
                  await signInWithRedirect(auth, provider);
                })
              }
            >
              Continue with Google
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="link"
              disabled={pending}
              onClick={() => {
                setMode(mode === "register" ? "login" : "register");
                setNotice("");
              }}
            >
              {mode === "register"
                ? "Already have an account? Sign in"
                : "Create an account"}
            </Button>
            <Button
              variant="link"
              disabled={pending}
              onClick={() => {
                setMode(mode === "reset" ? "login" : "reset");
                setNotice("");
              }}
            >
              {mode === "reset" ? "Back to sign in" : "Forgot password?"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
