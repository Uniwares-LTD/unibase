import Link from "next/link";
import { ArrowLeft, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <section className="reading-surface mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <Map className="mb-6 size-10 text-muted-foreground" aria-hidden="true" />
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Page not found
      </p>
      <h1 className="font-heading text-4xl tracking-tight">
        Let’s get you back.
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        This page may have moved, or the link may be incomplete.
      </p>
      <Button asChild className="mt-7 h-11">
        <Link href="/">
          <ArrowLeft aria-hidden="true" />
          Back to home
        </Link>
      </Button>
    </section>
  );
}
