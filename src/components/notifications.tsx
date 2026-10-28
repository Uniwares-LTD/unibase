"use client";
import { useTranslations } from "next-intl";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge } from "./ui/badge";
import { z } from "zod";
import { api } from "@/lib/client/api";
import { notificationPageSchema } from "@/lib/contracts/notifications";
import { DateLabel } from "./localized-value";
import { EmptyState, Notice } from "./page-patterns";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
type Page = z.infer<typeof notificationPageSchema>;

// One unread poll per document, shared by the header badge and the inbox.
const UnreadContext = createContext<number | null>(null);
export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      if (document.hidden) return;
      controller = new AbortController();
      void api("/api/notifications", notificationPageSchema, {
        signal: controller.signal,
      })
        .then((data) => setUnread(data.unread))
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("notifications-changed", refresh);
    return () => {
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("notifications-changed", refresh);
    };
  }, []);
  return (
    <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>
  );
}
export function NotificationBadge() {
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const unread = useContext(UnreadContext) ?? 0;
  return (
    <Button asChild variant="ghost">
      <Link
        href="/notifications"
        aria-label={common("notificationBadge", { count: unread })}
      >
        <Bell aria-hidden="true" />
        <span className="hidden sm:inline">{translate("m788011833a5a")}</span>
        {unread > 0 && <Badge>{unread > 99 ? "99+" : unread}</Badge>}
      </Link>
    </Button>
  );
}
export function NotificationInbox({ initial }: { initial: Page }) {
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const [page, setPage] = useState(initial),
    [cursor, setCursor] = useState<string>(),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const unread = useContext(UnreadContext) ?? page.unread;
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setFailed(false);
    try {
      await action();
      window.dispatchEvent(new Event("notifications-changed"));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function load(next?: string) {
    setPage(
      await api(
        "/api/notifications" +
          (next ? `?cursor=${encodeURIComponent(next)}` : ""),
        notificationPageSchema,
      ),
    );
    setCursor(next);
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {common("unread", { count: unread })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || unread === 0}
            onClick={() =>
              void perform(async () => {
                await api("/api/notifications", z.object({ ok: z.boolean() }), {
                  method: "PATCH",
                  body: { all: true },
                });
                await load(cursor);
              })
            }
          >
            {translate("m3bc62a9e6a39")}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void perform(() => load(cursor))}
          >
            {translate("m0e9161011702")}
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/preferences#notifications">
              {translate("m868cb91d007c")}
            </Link>
          </Button>
        </div>
      </div>
      {failed && <Notice tone="error" title={translate("me6c5c7ec5c6b")} />}
      {page.rows.length ? (
        <ul className="space-y-3">
          {page.rows.map((row) => (
            <li key={row.id}>
              <Card className="shadow-none">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0 space-y-1">
                    <Link
                      href={row.href}
                      className={
                        row.read
                          ? "underline-offset-4 hover:underline"
                          : "font-semibold underline-offset-4 hover:underline"
                      }
                    >
                      {row.text}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      <DateLabel value={row.createdAt} />
                    </p>
                  </div>
                  {!row.read && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(
                            "/api/notifications",
                            z.object({ ok: z.boolean() }),
                            { method: "PATCH", body: { ids: [row.id] } },
                          );
                          setPage((old) => ({
                            ...old,
                            rows: old.rows.map((item) =>
                              item.id === row.id
                                ? { ...item, read: true }
                                : item,
                            ),
                          }));
                        })
                      }
                    >
                      {translate("mb49c9b6cdf43")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={translate("mca02c722b098")}
          description={translate("ma5d6e4446495")}
        />
      )}
      {(cursor || page.next) && (
        <div className="flex flex-wrap gap-2">
          {cursor && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void perform(() => load())}
            >
              {translate("m0d8a7f399c78")}
            </Button>
          )}
          {page.next && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void perform(() => load(page.next!))}
            >
              {translate("ma503a8160702")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
