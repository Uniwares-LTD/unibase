"use client";
import { useEffect } from "react";
import { diagnostics } from "@/lib/client/diagnostics";
import { Button } from "@/components/ui/button";
import "./globals.css";
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    diagnostics.record("global-error");
  }, []);
  return (
    <html lang="en">
      <body className="bg-background font-sans text-foreground">
        <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 py-12">
          <h1 className="font-heading text-3xl">
            We couldn’t load your space.
          </h1>
          <p className="mt-4 text-muted-foreground">
            Please try again. If the problem continues, come back in a moment.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={retry} className="h-11">
              Try again
            </Button>
            <Button variant="outline" asChild className="h-11">
              {/* A full document navigation recovers even if the root layout failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">Back to home</a>
            </Button>
          </div>
        </main>
      </body>
    </html>
  );
}
