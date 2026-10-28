"use client";
import { useTranslations } from "next-intl";

import { useEffect } from "react";
import { diagnostics } from "@/lib/client/diagnostics";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const translate = useTranslations("ui");

  useEffect(() => {
    diagnostics.record("route-error");
  }, []);
  return (
    <section className="reading-surface mx-auto max-w-lg py-12">
      <h1 className="mb-6 font-heading text-3xl">
        {translate("m5d23895023bf")}
      </h1>
      <Alert>
        <AlertCircle aria-hidden="true" />
        <AlertTitle>{translate("ma4bc99766fde")}</AlertTitle>
        <AlertDescription>{translate("m88781c9f0966")}</AlertDescription>
      </Alert>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button onClick={retry} className="h-11">
          {translate("md8b8392e2c54")}
        </Button>
        <Button variant="outline" asChild className="h-11">
          <Link href="/">{translate("m76c5505ff2e2")}</Link>
        </Button>
      </div>
    </section>
  );
}
