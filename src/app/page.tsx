import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
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
import { publicSettings } from "@/lib/server/settings";

export default async function HomePage() {
  const translate = await getTranslations("ui");

  const { appName } = await publicSettings();
  return (
    <PageMessages path="/">
      {
        <div className="space-y-10">
          <section className="reading-surface relative overflow-hidden rounded-2xl border bg-secondary/45 px-6 py-10 sm:px-10 sm:py-14">
            <div
              aria-hidden="true"
              className="absolute -top-20 -end-20 size-72 rounded-full border-[32px] border-primary/5"
            />
            <div className="relative max-w-lg">
              <span className="mb-6 flex size-12 items-center justify-center rounded-2xl border bg-background">
                <BookOpen className="size-6 text-primary" aria-hidden="true" />
              </span>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {translate("mded56dcbe5cc")}{" "}
              </p>
              <h1 className="font-heading text-4xl leading-tight tracking-tight sm:text-5xl">
                {translate("m0e6b8e5c5379")} {appName}.
              </h1>
              <p className="mt-5 max-w-sm text-base leading-relaxed text-muted-foreground">
                {translate("mb6a63358cc0c")}{" "}
              </p>
              <Button asChild className="mt-7 h-11">
                <Link href="/preferences">
                  {translate("m34ca8a4540f5")} <ArrowRight aria-hidden="true" />
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
                {translate("mea7552207078")}{" "}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {translate("mc146e2f33b3e")}{" "}
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Card className="shadow-none">
                <CardHeader>
                  <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-secondary">
                    <UserRound className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle>{translate("mdbb5f6371b6a")}</CardTitle>
                  <CardDescription>
                    {translate("mb72bfd6ac61e")}{" "}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" asChild className="h-10">
                    <Link href="/account">
                      {translate("m4071433234fe")}{" "}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardHeader>
                  <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-secondary">
                    <Palette className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle>{translate("m22c0f0a23168")}</CardTitle>
                  <CardDescription>
                    {translate("mb44f7b018207")}{" "}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" asChild className="h-10">
                    <Link href="/preferences">
                      {translate("m2521a1a3a4a5")}{" "}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      }
    </PageMessages>
  );
}
