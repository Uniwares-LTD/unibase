import { ArrowRight, BookOpen, Palette, UserRound } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getConfig } from "@/lib/server/config";

export default function HomePage() {
  const {
    public: { appName },
  } = getConfig();
  return (
    <div className="space-y-10">
      <section className="reading-surface relative overflow-hidden rounded-2xl border bg-secondary/45 px-6 py-10 sm:px-10 sm:py-14">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 size-72 rounded-full border-[32px] border-primary/5"
        />
        <div className="relative max-w-lg">
          <span className="mb-6 flex size-12 items-center justify-center rounded-2xl border bg-background">
            <BookOpen className="size-6 text-primary" aria-hidden="true" />
          </span>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            A new beginning
          </p>
          <h1 className="font-heading text-4xl leading-tight tracking-tight sm:text-5xl">
            Welcome to {appName}.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
            Make yourself at home. Find your account and choose a look that
            feels right for you.
          </p>
          <Button asChild className="mt-7 h-11">
            <Link href="/preferences">
              Make it yours <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
      <section aria-labelledby="explore-title">
        <div className="reading-surface glass-inset mb-5">
          <h2
            id="explore-title"
            className="text-lg font-semibold tracking-tight"
          >
            Your essentials
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A few things to help you settle in.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="shadow-none">
            <CardHeader>
              <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-secondary">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>Your account</CardTitle>
              <CardDescription>
                One place for your profile and account details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" asChild className="h-10">
                <Link href="/account">
                  View account <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-none">
            <CardHeader>
              <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-secondary">
                <Palette className="size-5" aria-hidden="true" />
              </span>
              <CardTitle>A look that fits</CardTitle>
              <CardDescription>
                Choose light, dark, or follow your device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" asChild className="h-10">
                <Link href="/preferences">
                  Change appearance <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
