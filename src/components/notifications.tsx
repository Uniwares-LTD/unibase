"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Badge } from "./ui/badge";
import { z } from "zod";
import { api } from "@/lib/client/api";
import {
  notificationPageSchema,
  notificationPreferencesSchema,
} from "@/lib/contracts/notifications";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
type Page = z.infer<typeof notificationPageSchema>;
function useUnread(initial = 0) {
  const [unread, setUnread] = useState(initial);
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
  return unread;
}
export function NotificationBadge() {
  const translate = useTranslations("ui");
  const common = useTranslations("common");

  const unread = useUnread();
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unread = useUnread(page.unread);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      window.dispatchEvent(new Event("notifications-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : translate("me6c5c7ec5c6b"));
    } finally {
      setBusy(false);
    }
  }
  async function refresh(cursor?: string) {
    setPage(
      await api(
        "/api/notifications" +
          (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
        notificationPageSchema,
      ),
    );
  }
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">{translate("m788011833a5a")}</h1>
      <p>{common("unread", { count: unread })}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await api("/api/notifications", z.object({ ok: z.boolean() }), {
                method: "PATCH",
                body: { all: true },
              });
              await refresh();
            })
          }
        >
          {translate("m3bc62a9e6a39")}{" "}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void perform(() => refresh())}
        >
          {translate("m0e9161011702")}{" "}
        </Button>
      </div>
      <fieldset className="space-y-3">
        <legend>{translate("m19a58710832b")}</legend>
        {(["runs", "credits", "account"] as const).map((category) => (
          <div key={category} className="flex items-center gap-3">
            <Checkbox
              id={`notifications-${category}`}
              checked={page.preferences[category]}
              disabled={busy}
              onCheckedChange={(value) =>
                void perform(async () => {
                  const preferences = await api(
                    "/api/notifications/preferences",
                    notificationPreferencesSchema,
                    {
                      method: "PATCH",
                      body: { ...page.preferences, [category]: value === true },
                    },
                  );
                  setPage((old) => ({ ...old, preferences }));
                })
              }
            />
            <Label htmlFor={`notifications-${category}`}>
              {category === "runs"
                ? translate("m848f54e89660")
                : category === "credits"
                  ? translate("m2a6b24ad2872")
                  : translate("m7738853a0f09")}
            </Label>
          </div>
        ))}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <ul className="space-y-3">
        {page.rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded border p-3"
          >
            <Link href={row.href} className={row.read ? "" : "font-semibold"}>
              {row.text}
            </Link>
            {!row.read && (
              <Button
                variant="outline"
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
                        item.id === row.id ? { ...item, read: true } : item,
                      ),
                    }));
                  })
                }
              >
                {translate("mb49c9b6cdf43")}{" "}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!page.rows.length && <p>{translate("mca02c722b098")}</p>}
      {page.next && (
        <Button
          disabled={busy}
          onClick={() => void perform(() => refresh(page.next!))}
        >
          {translate("ma503a8160702")}{" "}
        </Button>
      )}
    </section>
  );
}
