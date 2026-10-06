"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
import { ThemePreference } from "./theme-preference";
import { StylePreference } from "./style-preference";
import { EmptyState, Notice } from "./page-patterns";
import { CreditSummary } from "./credit-summary";

const sampleWallet = {
  balance: 125,
  available: 125,
  reserved: 0,
  debt: 0,
  upcoming: [],
  holds: [],
  nextBefore: null,
  history: [
    {
      id: "sample",
      sequence: 1,
      kind: "grant",
      delta: 125,
      reservedDelta: 0,
      balanceAfter: 125,
      debtAfter: 0,
      timestamp: "2026-10-05T10:00:00.000Z",
      reason: "Sample promotional grant",
    },
  ],
};

export function DesignShowcase() {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="page-stack">
      <Notice title="Development samples only">
        No accounts, credits or stories are changed here. The appearance
        selector updates this browser&apos;s theme preference.
      </Notice>
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Inspect the same components in light, dark and system modes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            <StylePreference />
            <ThemePreference />
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Glass uses this page&apos;s declared cover. Try an image, no
                image, or a failed image to compare the gradient fallback.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" asChild>
                  <Link href="/design-system" scroll={false}>
                    Sample cover
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/design-system?cover=none" scroll={false}>
                    No cover
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/design-system?cover=broken" scroll={false}>
                    Broken cover
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <section
        aria-labelledby="tokens-title"
        className="reading-surface glass-inset space-y-4"
      >
        <h2 id="tokens-title" className="text-xl font-semibold">
          Colors and typography
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            "bg-background text-foreground",
            "bg-primary text-primary-foreground",
            "bg-secondary text-secondary-foreground",
            "bg-success text-success-foreground",
            "bg-warning text-warning-foreground",
            "bg-info text-info-foreground",
          ].map((style, index) => (
            <div key={style} className={`rounded-lg border p-5 ${style}`}>
              <p className="font-medium">
                {
                  [
                    "Canvas",
                    "Primary action",
                    "Secondary",
                    "Success",
                    "Warning",
                    "Information",
                  ][index]
                }
              </p>
              <p className="mt-1 text-sm">Surface and foreground pair</p>
            </div>
          ))}
        </div>
        <p className="font-heading text-3xl">
          A small idea can become a story.
        </p>
        <p className="reading-copy">
          Use readable body text for guidance and longer passages. Keep controls
          concise and give every screen one clear next action.
        </p>
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Controls and form states</CardTitle>
          <CardDescription>
            These examples use the installed shadcn primitives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => setSaved(true)}>
              Sample action
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setSaved(false);
                setConfirmed(false);
              }}
            >
              Reset feedback
            </Button>
            <Button variant="outline" disabled>
              Unavailable
            </Button>
            <Button disabled aria-busy="true">
              Saving…
            </Button>
          </div>
          <form
            className="max-w-md space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const valid = name.trim().length > 0;
              setError(!valid);
              setSaved(valid);
            }}
            noValidate
          >
            <Label htmlFor="sample-name">Sample title</Label>
            <Input
              id="sample-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSaved(false);
              }}
              aria-invalid={error}
              aria-describedby="sample-help"
            />
            <p
              id="sample-help"
              className={
                error
                  ? "text-sm text-destructive"
                  : "text-sm text-muted-foreground"
              }
            >
              {error
                ? "Enter a title before saving."
                : "Stored only in this page's memory."}
            </p>
            <Button type="submit">Save sample</Button>
          </form>
          {saved && (
            <Notice tone="success" title="Sample saved">
              This is local feedback; no server request was made.
            </Notice>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Review sample action</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm sample action?</AlertDialogTitle>
                <AlertDialogDescription>
                  This demonstrates confirmation and focus behavior. It changes
                  only this page&apos;s sample feedback.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => setConfirmed(true)}>
                  Confirm sample
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {confirmed && <Notice tone="success" title="Sample confirmed" />}
        </CardContent>
      </Card>
      <section aria-labelledby="states-title" className="space-y-4">
        <h2 id="states-title" className="text-xl font-semibold">
          Feedback and empty states
        </h2>
        <Notice tone="warning" title="Review suggested">
          This finding is optional. It does not approve, regenerate or charge
          for work.
        </Notice>
        <Notice tone="info" title="Checking the result">
          The outcome is not yet confirmed. Do not submit the same paid action
          again.
        </Notice>
        <Notice tone="error" title="Could not save">
          Your draft is still available. Try again when the service recovers.
        </Notice>
        <EmptyState
          title="No stories yet"
          description="When the creator workspace is implemented, saved stories will appear here."
        />
      </section>
      <section aria-labelledby="wallet-title" className="space-y-4">
        <h2 id="wallet-title" className="text-xl font-semibold">
          Sample wallet and ledger
        </h2>
        <CreditSummary account={sampleWallet} historyPath="/design-system" />
      </section>
      <section aria-labelledby="preview-title" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="preview-title" className="text-xl font-semibold">
            Creator workspace preview
          </h2>
          <Badge variant="outline">Static concept · not implemented</Badge>
        </div>
        <div className="grid gap-5 lg:grid-cols-[12rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Story stages</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4 text-sm">
                <li className="font-semibold text-primary">
                  1. Concept · review
                </li>
                <li>2. Outline · waiting</li>
                <li>3. References · waiting</li>
                <li>4. Pages · waiting</li>
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>The little lighthouse</CardTitle>
              <CardDescription>
                Concept version 2 · sample content
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="reading-copy font-heading text-lg">
                A curious keeper discovers that a small light can guide more
                than ships. A gentle story about helping others find their way.
              </p>
              <Notice title="Approval identifies a version">
                A future approval applies to this exact concept version.
                Revising it retains the previous version.
              </Notice>
              <div className="flex flex-wrap gap-3">
                <Button disabled>Approve version 2</Button>
                <Button variant="outline" disabled>
                  Request revision
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Future generation will show its credit price before
                confirmation. No generation runs from this preview.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
