"use client";
import {
  ChevronDown,
  Settings2,
  UserRound,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
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
import { SessionControls } from "@/components/session-controls";

export function AccountMenuControls({
  hasSession,
  isAdmin,
}: {
  hasSession: boolean;
  isAdmin: boolean;
}) {
  return (
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
          <Link href="/credits">
            <Wallet aria-hidden="true" />
            Credits
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/preferences">
            <Settings2 aria-hidden="true" />
            Preferences
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldCheck aria-hidden="true" />
              Administration
            </Link>
          </DropdownMenuItem>
        )}
        {hasSession && (
          <>
            <DropdownMenuSeparator />
            <SessionControls />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
