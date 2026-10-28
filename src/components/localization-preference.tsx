"use client";
import { useLocale, useTranslations, useTimeZone } from "next-intl";
import { useState } from "react";
import { localeCookie } from "@/lib/locale";
import { project } from "@/lib/project";
import { api } from "@/lib/client/api";
import { profileSchema } from "@/lib/contracts/profile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
export function LocalizationPreference({ canSave }: { canSave: boolean }) {
  const locale = useLocale(),
    t = useTranslations("locale"),
    zone = useTimeZone();
  const [timeZone, setTimeZone] = useState(zone ?? "UTC"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{t("heading")}</CardTitle>
        <CardDescription>{t("browser")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="locale-choice">{t("language")}</Label>
          <Select
            value={locale}
            onValueChange={(value) => {
              document.cookie = `${localeCookie}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`;
              location.reload();
            }}
          >
            <SelectTrigger id="locale-choice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.locales.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "ar" ? "العربية" : "English"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canSave ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setMessage("");
              void api("/api/profile/localization", profileSchema, {
                method: "PATCH",
                body: { locale, timeZone },
              })
                .then(() => location.reload())
                .catch(() => setMessage(t("failed")))
                .finally(() => setBusy(false));
            }}
          >
            <Label htmlFor="time-zone">{t("timeZone")}</Label>
            <Input
              id="time-zone"
              dir="ltr"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              maxLength={100}
              disabled={busy}
              placeholder="UTC"
            />
            <Button disabled={busy}>{t("save")}</Button>
            <p role="status">{message}</p>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t("signIn")}</p>
        )}
      </CardContent>
    </Card>
  );
}
