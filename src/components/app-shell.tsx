"use client";
import { BookOpen, Sparkles, Home, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const routes = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/runs/new", label: "Start run", Icon: Sparkles },
  { href: "/runs", label: "Runs", Icon: BookOpen },
];

function matchesRoute(pathname: string, href: string) {
  if (href === "/runs" && pathname === "/runs/new") return false;
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function Brand({ name }: { name: string }) {
  return (
    <Link
      href="/"
      aria-label={`${name} home`}
      className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <BookOpen className="size-5" aria-hidden="true" />
      </span>
      <span className="truncate text-xl font-semibold tracking-tight">
        {name}
      </span>
    </Link>
  );
}

function Navigation({
  label,
  onNavigate,
}: {
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="space-y-1.5">
      {routes.map(({ href, label: routeLabel, Icon }) => (
        <Button
          key={href}
          variant="ghost"
          asChild
          className={cn(
            "h-11 w-full justify-start gap-3 px-3 text-sm",
            matchesRoute(pathname, href) &&
              "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
          )}
        >
          <Link
            href={href}
            aria-current={matchesRoute(pathname, href) ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" className="size-[18px]" />
            {routeLabel}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

export function AppShell({
  appName,
  children,
  accountMenu,
}: {
  appName: string;
  children: React.ReactNode;
  accountMenu: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title =
    [
      ...routes,
      { href: "/account", label: "Account" },
      { href: "/credits", label: "Credits" },
      { href: "/preferences", label: "Preferences" },
    ].find((route) => matchesRoute(pathname, route.href))?.label ??
    (pathname.startsWith("/admin")
      ? "Administration"
      : pathname === "/design-system"
        ? "Design system"
        : appName);
  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only fixed top-3 left-3 z-[100] rounded-md bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <aside className="shell-surface fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-sidebar p-6 text-sidebar-foreground md:flex">
        <Brand name={appName} />
        <p className="mt-12 mb-4 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Your space
        </p>
        <Navigation label="Main navigation" />
        <div className="mt-auto">
          <Separator className="mb-5" />
          <p className="px-3 text-xs leading-relaxed text-muted-foreground">
            Your ideas, with room to grow.
          </p>
        </div>
      </aside>
      <div className="md:pl-64">
        <header className="shell-surface flex h-20 items-center justify-between gap-4 border-b bg-background px-5 sm:px-8 lg:px-12">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 md:hidden"
                  aria-label="Open navigation"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 overflow-y-auto overscroll-contain bg-sidebar p-6"
              >
                <SheetHeader className="px-0 pt-6">
                  <SheetTitle>{appName}</SheetTitle>
                  <SheetDescription>
                    Find your way around your space.
                  </SheetDescription>
                </SheetHeader>
                <Navigation
                  label="Mobile navigation"
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <span className="truncate text-sm font-medium text-muted-foreground">
              {title}
            </span>
          </div>
          {accountMenu}
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-6xl px-5 py-10 outline-none sm:px-8 sm:py-12 lg:px-12"
        >
          {children}
        </main>
        <footer className="shell-footer mx-auto max-w-6xl px-5 pb-8 text-xs text-muted-foreground sm:px-8 lg:px-12">
          {appName} · Make it yours.
        </footer>
      </div>
    </div>
  );
}
