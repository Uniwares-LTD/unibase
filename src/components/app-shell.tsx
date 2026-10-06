"use client";
import {
  BookOpen,
  Wallet,
  Sparkles,
  ChevronDown,
  Home,
  Menu,
  Settings2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  { href: "/account", label: "Account", Icon: UserRound },
  { href: "/credits", label: "Credits", Icon: Wallet },
  { href: "/ai", label: "AI workspace", Icon: Sparkles },
  { href: "/preferences", label: "Preferences", Icon: Settings2 },
];

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
            pathname === href &&
              "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
          )}
        >
          <Link
            href={href}
            aria-current={pathname === href ? "page" : undefined}
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
}: {
  appName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const title =
    routes.find((route) => route.href === pathname)?.label ??
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-11 gap-2 rounded-full px-2"
                aria-label="Open account menu"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-secondary">
                    <UserRound className="size-4" aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">Your account</span>
                <ChevronDown
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Your space</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/account">
                  <UserRound aria-hidden="true" />
                  Account
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/preferences">
                  <Settings2 aria-hidden="true" />
                  Preferences
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
