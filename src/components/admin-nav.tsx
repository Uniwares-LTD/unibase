"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { matchesRoute } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

// Labels are translated on the server; this component only marks the current page.
export function AdminNav({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="-mx-1 flex flex-nowrap gap-1 overflow-x-auto px-1 pb-2 sm:flex-wrap"
    >
      {items.map(({ href, label: itemLabel }) => {
        // The overview matches only itself; sections also match their detail pages.
        const active =
          href === "/admin" ? pathname === href : matchesRoute(pathname, href);
        return (
          <Button
            key={href}
            variant={active ? "secondary" : "ghost"}
            asChild
            className="shrink-0"
          >
            <Link href={href} aria-current={active ? "page" : undefined}>
              {itemLabel}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
