"use client";
import { useTranslations } from "next-intl";

import { NotificationBadge } from "./notifications";
import { moduleEnabled } from "@/lib/project";
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
  const translate = useTranslations("ui");

  return (
    <div className="flex items-center gap-2">
      {hasSession && moduleEnabled("notifications") && <NotificationBadge />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-11 gap-2 rounded-full px-2"
            aria-label={translate("m04b5bfe665e3")}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-secondary">
                <UserRound className="size-4" aria-hidden="true" />
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm sm:inline">
              {translate("mdbb5f6371b6a")}
            </span>
            <ChevronDown
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{translate("m478e47e459be")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account">
              <UserRound aria-hidden="true" />
              {translate("m7e1b0d5641f2")}{" "}
            </Link>
          </DropdownMenuItem>
          {moduleEnabled("credits") && (
            <DropdownMenuItem asChild>
              <Link href="/credits">
                <Wallet aria-hidden="true" />
                {translate("m2a6b24ad2872")}{" "}
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href="/preferences">
              <Settings2 aria-hidden="true" />
              {translate("m66962f72a088")}{" "}
            </Link>
          </DropdownMenuItem>
          {isAdmin && (
            <DropdownMenuItem asChild>
              <Link href="/admin">
                <ShieldCheck aria-hidden="true" />
                {translate("m4b42c6690ebe")}{" "}
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
    </div>
  );
}
